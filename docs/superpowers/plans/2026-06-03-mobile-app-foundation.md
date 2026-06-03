# 모바일 앱 토대 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PT의 `scan-result.json`을 가져와 파싱하고, 스냅샷 히스토리로 로컬 DB에 누적 저장하는 Flutter 앱의 데이터 토대를 만든다 (화면 없음, import 후 프로젝트 개수만 보이는 최소 동작 앱).

**Architecture:** `ScanDataSource`(파일 로드) → 관용적 파서로 `ScanResult` → `SnapshotRepository`(Drift/SQLite)에 스냅샷 누적 → Riverpod provider로 노출. 모든 도메인 로직은 순수 함수/얇은 서비스로 분리해 단위 테스트한다.

**Tech Stack:** Flutter, Riverpod, Drift(SQLite), 손수 작성한 tolerant `fromJson`(json_serializable 코드젠 미사용), flutter_test.

> **스펙 대비 의도된 차이:** 스펙 기술표는 freezed + json_serializable이지만, 토대에서는 손수 작성한 tolerant `fromJson`을 쓴다. 미지 필드 무시·부분 파싱 요구(스펙 §2/§4)를 더 잘 만족하고 `build_runner` 없이 TDD 루프가 깨끗하다. freezed 채택은 후속 과제.

> **앱 위치:** `/Users/jean325/portfolio/projects/pt-mobile/`. 이하 모든 경로는 이 디렉토리 기준 상대경로다.

---

## File Structure

| 파일 | 책임 |
|------|------|
| `lib/models/scan_result.dart` | `ScanResult`, `ScanSummary` 모델 + tolerant `fromJson` |
| `lib/models/project.dart` | `Project`, `Progress`, `Activity`, `Metadata`, `Priority` 모델 + tolerant `fromJson` |
| `lib/data/scan_data_source.dart` | `ScanDataSource` 인터페이스 + `FileScanDataSource` 구현 |
| `lib/data/snapshot_database.dart` | Drift 데이터베이스 정의 (`Snapshots` 테이블) |
| `lib/data/snapshot_repository.dart` | 스냅샷 적재/조회 repository |
| `lib/providers.dart` | Riverpod providers (dataSource, repository, 현재 스냅샷) |
| `lib/main.dart` | 앱 엔트리: import 버튼 + 프로젝트 개수 표시 |
| `test/fixtures/sample_scan_result.json` | 파싱 테스트용 픽스처 |
| `test/models/project_test.dart` | 프로젝트 파싱 테스트 |
| `test/models/scan_result_test.dart` | 스캔결과 파싱 테스트 |
| `test/data/snapshot_repository_test.dart` | repository 테스트 (인메모리 Drift) |

---

## Task 1: Flutter 프로젝트 스캐폴드

**Files:**
- Create: `/Users/jean325/portfolio/projects/pt-mobile/` (전체 프로젝트)

- [ ] **Step 1: Flutter 프로젝트 생성**

`flutter-create` 스킬을 사용하거나 직접 실행:

```bash
cd /Users/jean325/portfolio/projects
flutter create --org com.portfoliotracker --project-name pt_mobile pt-mobile
```

- [ ] **Step 2: 의존성 추가**

`pt-mobile/pubspec.yaml`의 `dependencies`에 추가하고 설치:

```yaml
dependencies:
  flutter:
    sdk: flutter
  flutter_riverpod: ^2.5.1
  drift: ^2.18.0
  sqlite3_flutter_libs: ^0.5.0
  path_provider: ^2.1.0
  path: ^1.9.0
  file_picker: ^8.0.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  drift_dev: ^2.18.0
  build_runner: ^2.4.0
```

Run: `cd /Users/jean325/portfolio/projects/pt-mobile && flutter pub get`
Expected: `Got dependencies!` (에러 없음)

- [ ] **Step 3: 기본 테스트가 도는지 확인**

Run: `cd /Users/jean325/portfolio/projects/pt-mobile && flutter test`
Expected: 기본 위젯 테스트 PASS (혹은 main.dart 정리 후 통과)

- [ ] **Step 4: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile
git init
git add -A
git commit -m "chore: scaffold pt-mobile Flutter project"
```

---

## Task 2: Project 모델 (tolerant 파서)

**Files:**
- Create: `lib/models/project.dart`
- Create: `test/fixtures/sample_scan_result.json`
- Test: `test/models/project_test.dart`

- [ ] **Step 1: 픽스처 작성**

`test/fixtures/sample_scan_result.json` 생성 (PT 실제 출력 1건 + 누락 필드 1건):

```json
{
  "scannedAt": "2026-06-02T22:47:50.883Z",
  "summary": { "total": 2, "averageReadiness": 70 },
  "projects": [
    {
      "id": "discord-kakao-translator",
      "name": "discord-kakao-translator",
      "path": "/Users/jean325/portfolio/projects/discord-kakao-translator",
      "type": "node",
      "progress": { "percentage": 85, "source": "readme", "confidence": "high", "signals": ["README.md: explicit 85% progress"], "lastUpdated": "2026-06-02T22:47:50.882Z" },
      "priority": "CRITICAL",
      "activity": { "lastCommitDate": "2026-04-09T10:08:44.000Z", "lastCommitMessage": "Initial commit", "commitsInLastWeek": 0, "isActive": false, "daysSinceLastCommit": 54 },
      "metadata": { "description": "Discord -> Korean -> KakaoTalk", "stack": ["node", "Node.js"], "hasReadme": true, "hasClaude": false, "hasGit": true },
      "baseReadiness": 77,
      "readiness": 77,
      "nextActions": ["문서 보강"],
      "issues": ["30일 이상 커밋 없음"],
      "scannedAt": "2026-06-02T22:47:50.883Z"
    },
    {
      "id": "sparse-project",
      "name": "sparse-project",
      "path": "/tmp/sparse",
      "type": "unknown",
      "priority": "LOW",
      "readiness": 10
    }
  ]
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`test/models/project_test.dart`:

```dart
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/models/project.dart';

void main() {
  Map<String, dynamic> firstProjectJson() {
    final raw = File('test/fixtures/sample_scan_result.json').readAsStringSync();
    return (jsonDecode(raw)['projects'] as List).first as Map<String, dynamic>;
  }

  test('full project parses all fields', () {
    final p = Project.fromJson(firstProjectJson());
    expect(p.name, 'discord-kakao-translator');
    expect(p.priority, Priority.critical);
    expect(p.readiness, 77);
    expect(p.progress?.percentage, 85);
    expect(p.activity?.daysSinceLastCommit, 54);
    expect(p.metadata?.stack, contains('Node.js'));
    expect(p.issues, contains('30일 이상 커밋 없음'));
  });

  test('sparse project tolerates missing fields', () {
    final raw = File('test/fixtures/sample_scan_result.json').readAsStringSync();
    final sparse = (jsonDecode(raw)['projects'] as List)[1] as Map<String, dynamic>;
    final p = Project.fromJson(sparse);
    expect(p.name, 'sparse-project');
    expect(p.priority, Priority.low);
    expect(p.progress, isNull);
    expect(p.activity, isNull);
    expect(p.nextActions, isEmpty);
  });

  test('unknown priority falls back to low', () {
    final p = Project.fromJson({'id': 'x', 'name': 'x', 'priority': 'BOGUS'});
    expect(p.priority, Priority.low);
  });
}
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/models/project_test.dart`
Expected: FAIL — `Target of URI doesn't exist: 'package:pt_mobile/models/project.dart'`

- [ ] **Step 4: 모델 구현**

`lib/models/project.dart`:

```dart
enum Priority { critical, high, medium, low }

Priority _priorityFrom(Object? v) {
  switch (v?.toString().toUpperCase()) {
    case 'CRITICAL':
      return Priority.critical;
    case 'HIGH':
      return Priority.high;
    case 'MEDIUM':
      return Priority.medium;
    default:
      return Priority.low;
  }
}

class Progress {
  final int percentage;
  final String? source;
  final String? confidence;
  final List<String> signals;
  Progress({required this.percentage, this.source, this.confidence, this.signals = const []});
  factory Progress.fromJson(Map<String, dynamic> j) => Progress(
        percentage: (j['percentage'] as num?)?.toInt() ?? 0,
        source: j['source'] as String?,
        confidence: j['confidence'] as String?,
        signals: (j['signals'] as List?)?.cast<String>() ?? const [],
      );
}

class Activity {
  final DateTime? lastCommitDate;
  final String? lastCommitMessage;
  final int commitsInLastWeek;
  final bool isActive;
  final int daysSinceLastCommit;
  Activity({this.lastCommitDate, this.lastCommitMessage, this.commitsInLastWeek = 0, this.isActive = false, this.daysSinceLastCommit = 0});
  factory Activity.fromJson(Map<String, dynamic> j) => Activity(
        lastCommitDate: DateTime.tryParse(j['lastCommitDate']?.toString() ?? ''),
        lastCommitMessage: j['lastCommitMessage'] as String?,
        commitsInLastWeek: (j['commitsInLastWeek'] as num?)?.toInt() ?? 0,
        isActive: j['isActive'] as bool? ?? false,
        daysSinceLastCommit: (j['daysSinceLastCommit'] as num?)?.toInt() ?? 0,
      );
}

class Metadata {
  final String? description;
  final List<String> stack;
  final bool hasReadme;
  final bool hasClaude;
  final bool hasGit;
  Metadata({this.description, this.stack = const [], this.hasReadme = false, this.hasClaude = false, this.hasGit = false});
  factory Metadata.fromJson(Map<String, dynamic> j) => Metadata(
        description: j['description'] as String?,
        stack: (j['stack'] as List?)?.cast<String>() ?? const [],
        hasReadme: j['hasReadme'] as bool? ?? false,
        hasClaude: j['hasClaude'] as bool? ?? false,
        hasGit: j['hasGit'] as bool? ?? false,
      );
}

class Project {
  final String id;
  final String name;
  final String path;
  final String type;
  final Priority priority;
  final int readiness;
  final int baseReadiness;
  final Progress? progress;
  final Activity? activity;
  final Metadata? metadata;
  final List<String> nextActions;
  final List<String> issues;

  Project({
    required this.id,
    required this.name,
    this.path = '',
    this.type = 'unknown',
    this.priority = Priority.low,
    this.readiness = 0,
    this.baseReadiness = 0,
    this.progress,
    this.activity,
    this.metadata,
    this.nextActions = const [],
    this.issues = const [],
  });

  factory Project.fromJson(Map<String, dynamic> j) => Project(
        id: j['id']?.toString() ?? '',
        name: j['name']?.toString() ?? '',
        path: j['path']?.toString() ?? '',
        type: j['type']?.toString() ?? 'unknown',
        priority: _priorityFrom(j['priority']),
        readiness: (j['readiness'] as num?)?.toInt() ?? 0,
        baseReadiness: (j['baseReadiness'] as num?)?.toInt() ?? 0,
        progress: j['progress'] is Map ? Progress.fromJson((j['progress'] as Map).cast<String, dynamic>()) : null,
        activity: j['activity'] is Map ? Activity.fromJson((j['activity'] as Map).cast<String, dynamic>()) : null,
        metadata: j['metadata'] is Map ? Metadata.fromJson((j['metadata'] as Map).cast<String, dynamic>()) : null,
        nextActions: (j['nextActions'] as List?)?.cast<String>() ?? const [],
        issues: (j['issues'] as List?)?.cast<String>() ?? const [],
      );
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/models/project_test.dart`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile
git add lib/models/project.dart test/models/project_test.dart test/fixtures/sample_scan_result.json
git commit -m "feat: tolerant Project model parsing"
```

---

## Task 3: ScanResult 모델

**Files:**
- Create: `lib/models/scan_result.dart`
- Test: `test/models/scan_result_test.dart`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/models/scan_result_test.dart`:

```dart
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/models/scan_result.dart';

void main() {
  test('parses full scan result with summary and projects', () {
    final raw = File('test/fixtures/sample_scan_result.json').readAsStringSync();
    final r = ScanResult.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    expect(r.projects.length, 2);
    expect(r.scannedAt, isNotNull);
    expect(r.summary.total, 2);
  });

  test('tolerates missing summary and empty projects', () {
    final r = ScanResult.fromJson({});
    expect(r.projects, isEmpty);
    expect(r.summary.total, 0);
  });

  test('skips malformed project entries', () {
    final r = ScanResult.fromJson({
      'projects': [
        {'id': 'ok', 'name': 'ok'},
        'not-a-map',
      ]
    });
    expect(r.projects.length, 1);
    expect(r.projects.first.name, 'ok');
  });
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/models/scan_result_test.dart`
Expected: FAIL — `package:pt_mobile/models/scan_result.dart` 없음

- [ ] **Step 3: 구현**

`lib/models/scan_result.dart`:

```dart
import 'project.dart';

class ScanSummary {
  final int total;
  final double averageReadiness;
  ScanSummary({this.total = 0, this.averageReadiness = 0});
  factory ScanSummary.fromJson(Map<String, dynamic> j) => ScanSummary(
        total: (j['total'] as num?)?.toInt() ?? 0,
        averageReadiness: (j['averageReadiness'] as num?)?.toDouble() ?? 0,
      );
}

class ScanResult {
  final List<Project> projects;
  final DateTime? scannedAt;
  final ScanSummary summary;
  ScanResult({this.projects = const [], this.scannedAt, ScanSummary? summary})
      : summary = summary ?? ScanSummary();

  factory ScanResult.fromJson(Map<String, dynamic> j) {
    final rawProjects = (j['projects'] as List?) ?? const [];
    final projects = rawProjects
        .whereType<Map>()
        .map((e) => Project.fromJson(e.cast<String, dynamic>()))
        .toList();
    return ScanResult(
      projects: projects,
      scannedAt: DateTime.tryParse(j['scannedAt']?.toString() ?? ''),
      summary: j['summary'] is Map
          ? ScanSummary.fromJson((j['summary'] as Map).cast<String, dynamic>())
          : ScanSummary(total: projects.length),
    );
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/models/scan_result_test.dart`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile
git add lib/models/scan_result.dart test/models/scan_result_test.dart
git commit -m "feat: tolerant ScanResult model parsing"
```

---

## Task 4: ScanDataSource (파일 로드)

**Files:**
- Create: `lib/data/scan_data_source.dart`
- Test: `test/data/scan_data_source_test.dart`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/data/scan_data_source_test.dart`:

```dart
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/data/scan_data_source.dart';

void main() {
  test('FileScanDataSource loads and parses a file path', () async {
    final ds = FileScanDataSource();
    final result = await ds.loadFromPath('test/fixtures/sample_scan_result.json');
    expect(result.projects.length, 2);
  });

  test('throws ScanLoadException on missing file', () async {
    final ds = FileScanDataSource();
    expect(
      () => ds.loadFromPath('test/fixtures/does_not_exist.json'),
      throwsA(isA<ScanLoadException>()),
    );
  });

  test('throws ScanLoadException on invalid JSON', () async {
    final tmp = File('${Directory.systemTemp.path}/bad.json')..writeAsStringSync('{not json');
    final ds = FileScanDataSource();
    expect(() => ds.loadFromPath(tmp.path), throwsA(isA<ScanLoadException>()));
  });
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/data/scan_data_source_test.dart`
Expected: FAIL — `scan_data_source.dart` 없음

- [ ] **Step 3: 구현**

`lib/data/scan_data_source.dart`:

```dart
import 'dart:convert';
import 'dart:io';
import '../models/scan_result.dart';

class ScanLoadException implements Exception {
  final String message;
  ScanLoadException(this.message);
  @override
  String toString() => 'ScanLoadException: $message';
}

abstract class ScanDataSource {
  Future<ScanResult> loadFromPath(String path);
}

class FileScanDataSource implements ScanDataSource {
  @override
  Future<ScanResult> loadFromPath(String path) async {
    final file = File(path);
    if (!await file.exists()) {
      throw ScanLoadException('파일을 찾을 수 없습니다: $path');
    }
    try {
      final raw = await file.readAsString();
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) {
        throw ScanLoadException('최상위가 객체가 아닙니다');
      }
      return ScanResult.fromJson(decoded);
    } on FormatException catch (e) {
      throw ScanLoadException('JSON 파싱 실패: ${e.message}');
    }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/data/scan_data_source_test.dart`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile
git add lib/data/scan_data_source.dart test/data/scan_data_source_test.dart
git commit -m "feat: FileScanDataSource with error handling"
```

---

## Task 5: Drift 데이터베이스 + SnapshotRepository

**Files:**
- Create: `lib/data/snapshot_database.dart`
- Create: `lib/data/snapshot_repository.dart`
- Test: `test/data/snapshot_repository_test.dart`

- [ ] **Step 1: Drift 테이블 정의**

`lib/data/snapshot_database.dart`:

```dart
import 'package:drift/drift.dart';

part 'snapshot_database.g.dart';

class Snapshots extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get importedAt => dateTime()();
  DateTimeColumn get scannedAt => dateTime().nullable()();
  TextColumn get rawJson => text()();
}

@DriftDatabase(tables: [Snapshots])
class SnapshotDatabase extends _$SnapshotDatabase {
  SnapshotDatabase(super.e);

  @override
  int get schemaVersion => 1;
}
```

- [ ] **Step 2: 코드젠 실행**

Run: `cd /Users/jean325/portfolio/projects/pt-mobile && dart run build_runner build --delete-conflicting-outputs`
Expected: `snapshot_database.g.dart` 생성, `Succeeded`

- [ ] **Step 3: 실패하는 테스트 작성**

`test/data/snapshot_repository_test.dart`:

```dart
import 'dart:convert';
import 'dart:io';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/data/snapshot_database.dart';
import 'package:pt_mobile/data/snapshot_repository.dart';

void main() {
  late SnapshotDatabase db;
  late SnapshotRepository repo;

  setUp(() {
    db = SnapshotDatabase(NativeDatabase.memory());
    repo = SnapshotRepository(db);
  });
  tearDown(() => db.close());

  String sampleJson() => File('test/fixtures/sample_scan_result.json').readAsStringSync();

  test('saving a snapshot makes it the latest', () async {
    await repo.saveSnapshot(sampleJson());
    final latest = await repo.latest();
    expect(latest, isNotNull);
    expect(latest!.projects.length, 2);
  });

  test('history returns snapshots newest-first', () async {
    await repo.saveSnapshot(jsonEncode({'projects': [], 'scannedAt': '2026-01-01T00:00:00Z'}));
    await repo.saveSnapshot(jsonEncode({'projects': [], 'scannedAt': '2026-02-01T00:00:00Z'}));
    final history = await repo.history();
    expect(history.length, 2);
    expect(history.first.scannedAt!.isAfter(history.last.scannedAt!), isTrue);
  });

  test('latest is null when empty', () async {
    expect(await repo.latest(), isNull);
  });
}
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/data/snapshot_repository_test.dart`
Expected: FAIL — `snapshot_repository.dart` 없음

- [ ] **Step 5: Repository 구현**

`lib/data/snapshot_repository.dart`:

```dart
import 'dart:convert';
import 'package:drift/drift.dart';
import '../models/scan_result.dart';
import 'snapshot_database.dart';

class SnapshotRepository {
  final SnapshotDatabase _db;
  SnapshotRepository(this._db);

  Future<void> saveSnapshot(String rawJson) async {
    final result = ScanResult.fromJson(jsonDecode(rawJson) as Map<String, dynamic>);
    await _db.into(_db.snapshots).insert(SnapshotsCompanion.insert(
          importedAt: DateTime.now(),
          scannedAt: Value(result.scannedAt),
          rawJson: rawJson,
        ));
  }

  Future<ScanResult?> latest() async {
    final row = await (_db.select(_db.snapshots)
          ..orderBy([(t) => OrderingTerm.desc(t.importedAt)])
          ..limit(1))
        .getSingleOrNull();
    if (row == null) return null;
    return ScanResult.fromJson(jsonDecode(row.rawJson) as Map<String, dynamic>);
  }

  Future<List<ScanResult>> history() async {
    final rows = await (_db.select(_db.snapshots)
          ..orderBy([(t) => OrderingTerm.desc(t.importedAt)]))
        .get();
    return rows
        .map((r) => ScanResult.fromJson(jsonDecode(r.rawJson) as Map<String, dynamic>))
        .toList();
  }
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/data/snapshot_repository_test.dart`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile
git add lib/data/snapshot_database.dart lib/data/snapshot_database.g.dart lib/data/snapshot_repository.dart test/data/snapshot_repository_test.dart
git commit -m "feat: Drift snapshot database and repository"
```

---

## Task 6: Riverpod providers + 최소 import UI

**Files:**
- Create: `lib/providers.dart`
- Modify: `lib/main.dart` (전체 교체)
- Test: `test/widget_import_test.dart`

- [ ] **Step 1: providers 작성**

`lib/providers.dart`:

```dart
import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'data/scan_data_source.dart';
import 'data/snapshot_database.dart';
import 'data/snapshot_repository.dart';
import 'models/scan_result.dart';

final databaseProvider = Provider<SnapshotDatabase>((ref) {
  final db = SnapshotDatabase(NativeDatabase.memory());
  ref.onDispose(db.close);
  return db;
});

final repositoryProvider = Provider<SnapshotRepository>(
    (ref) => SnapshotRepository(ref.watch(databaseProvider)));

final dataSourceProvider = Provider<ScanDataSource>((ref) => FileScanDataSource());

final latestSnapshotProvider = FutureProvider<ScanResult?>(
    (ref) => ref.watch(repositoryProvider).latest());
```

> 참고: `databaseProvider`는 현재 인메모리다. 영속 DB(`path_provider` 경유 파일)로의 교체는 다음 화면 플랜에서 다룬다 (테스트는 override로 인메모리 주입).

- [ ] **Step 2: 실패하는 위젯 테스트 작성**

`test/widget_import_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/main.dart';
import 'package:pt_mobile/providers.dart';
import 'package:pt_mobile/data/snapshot_repository.dart';

void main() {
  testWidgets('shows project count after a snapshot is saved', (tester) async {
    late SnapshotRepository repo;
    await tester.pumpWidget(ProviderScope(
      child: Consumer(builder: (context, ref, _) {
        repo = ref.read(repositoryProvider);
        return const PtMobileApp();
      }),
    ));
    await repo.saveSnapshot(
        '{"projects":[{"id":"a","name":"a"},{"id":"b","name":"b"}],"summary":{"total":2}}');
    // 화면 갱신 트리거
    await tester.pumpAndSettle();
    expect(find.textContaining('프로젝트'), findsWidgets);
  });
}
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/widget_import_test.dart`
Expected: FAIL — `PtMobileApp` 미정의

- [ ] **Step 4: main.dart 구현**

`lib/main.dart` 전체 교체:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:file_picker/file_picker.dart';
import 'providers.dart';

void main() => runApp(const ProviderScope(child: PtMobileApp()));

class PtMobileApp extends StatelessWidget {
  const PtMobileApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'PT Mobile',
        theme: ThemeData(useMaterial3: true),
        home: const HomeScreen(),
      );
}

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  Future<void> _import(WidgetRef ref) async {
    final picked = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: ['json']);
    final path = picked?.files.single.path;
    if (path == null) return;
    final result = await ref.read(dataSourceProvider).loadFromPath(path);
    // 원본을 다시 읽어 저장 (repository가 raw json 보관)
    await ref.read(repositoryProvider).saveSnapshot(_encode(result));
    ref.invalidate(latestSnapshotProvider);
  }

  String _encode(dynamic _) => ''; // placeholder 대체: 아래 Step 5에서 제거

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final latest = ref.watch(latestSnapshotProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('PT Mobile')),
      body: Center(
        child: latest.when(
          loading: () => const CircularProgressIndicator(),
          error: (e, _) => Text('오류: $e'),
          data: (r) => Text(r == null ? '가져온 스캔 결과 없음' : '프로젝트 ${r.projects.length}개'),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _import(ref),
        child: const Icon(Icons.file_upload),
      ),
    );
  }
}
```

> **주의:** 위 `_encode`/`_import`는 raw json 보관을 위해 파일을 다시 읽는 편이 정확하다. 아래 Step 5에서 `DataSource`가 raw 문자열도 반환하도록 정리한다.

- [ ] **Step 5: raw 문자열 보존 정리 (DataSource에 loadRawFromPath 추가)**

`lib/data/scan_data_source.dart`의 `ScanDataSource`에 메서드를 추가하고 `FileScanDataSource`에 구현:

```dart
// abstract class ScanDataSource 에 추가:
Future<String> loadRawFromPath(String path);
```

```dart
// FileScanDataSource 에 추가:
@override
Future<String> loadRawFromPath(String path) async {
  final file = File(path);
  if (!await file.exists()) {
    throw ScanLoadException('파일을 찾을 수 없습니다: $path');
  }
  return file.readAsString();
}
```

그리고 `lib/main.dart`의 `_import`/`_encode`를 교체:

```dart
Future<void> _import(WidgetRef ref) async {
  final picked = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: ['json']);
  final path = picked?.files.single.path;
  if (path == null) return;
  final raw = await ref.read(dataSourceProvider).loadRawFromPath(path);
  await ref.read(repositoryProvider).saveSnapshot(raw);
  ref.invalidate(latestSnapshotProvider);
}
```

`_encode` 메서드는 삭제한다.

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd /Users/jean325/portfolio/projects/pt-mobile && flutter test`
Expected: 전체 PASS

- [ ] **Step 7: 정적 분석 확인**

Run: `cd /Users/jean325/portfolio/projects/pt-mobile && flutter analyze`
Expected: `No issues found!`

- [ ] **Step 8: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile
git add lib/providers.dart lib/main.dart lib/data/scan_data_source.dart test/widget_import_test.dart
git commit -m "feat: import flow with Riverpod and minimal UI"
```

---

## 후속 플랜 (이 토대 위에 별도 작성)

각 화면은 자체 수직 슬라이스로 독립 플랜:

1. **Dashboard** — summary 카드 + priority 분포/활동 차트 (fl_chart 도입, 영속 DB 전환)
2. **Projects** — 검색/필터/정렬 리스트 + 상세
3. **Recommendations** — `RecommendationEngine` 스코어링 + 스와이프 + 상호작용 기록
4. **Trends** — 스냅샷 히스토리 집계 + 시계열/히트맵
5. **Notifications** — `NotificationScheduler` + flutter_local_notifications + 트리거 6종

## Self-Review 메모

- **스펙 커버리지(토대 부분):** §3 데이터 접근(Task 4) / 영속화(Task 5) / 상태관리(Task 6) / §4 데이터 모델(Task 2~3) 충족. 화면·알림·추천(스펙 §5~7)은 후속 플랜으로 명시 분리.
- **영속 DB:** 이 토대는 인메모리 DB로 시작(테스트 결정성). Dashboard 플랜에서 `path_provider` 기반 파일 DB로 교체.
- **타입 일관성:** `ScanResult`, `Project`, `Priority`, `ScanDataSource.loadFromPath/loadRawFromPath`, `SnapshotRepository.saveSnapshot/latest/history` 전 태스크 동일 시그니처 사용 확인.
