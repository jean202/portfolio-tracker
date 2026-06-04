# 모바일 앱 Dashboard 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** import된 최신 스냅샷에서 전체 통계 카드 · 우선순위 분포 · 최근 활동 그래프를 보여주는 Dashboard 화면을 만들고, 인메모리 DB를 파일 영속 DB로 전환한다.

**Architecture:** 순수 함수 `DashboardStats.fromScan()`이 `ScanResult`를 받아 화면이 그릴 모든 수치(총계·평균·우선순위 카운트·최근 활동 막대)를 계산한다. 화면은 이 값만 렌더링한다. DB는 `path_provider` 기반 파일 연결로 전환하되, 테스트는 Riverpod override로 인메모리를 주입한다. 차트는 fl_chart를 도입한다.

**Tech Stack:** Flutter, Riverpod, Drift(파일 영속), fl_chart, flutter_test.

> **앱 위치:** `/Users/jean325/portfolio/projects/pt-mobile/`. 이하 모든 경로는 이 디렉토리 기준 상대경로다.
>
> **환경:** Flutter/Dart는 PATH에 없다. 모든 flutter/dart 명령 앞에 같은 줄에서 `export PATH="$PATH:/Users/jean325/development/flutter/bin" && ` 를 붙인다. Dart 3.11.5.

## 기존 토대 (이미 존재, 변경 주의)

- `lib/models/project.dart` — `Project{id,name,path,type,priority(Priority enum: critical/high/medium/low),readiness,baseReadiness,progress?,activity?,metadata?,nextActions,issues}`, `Progress{percentage,...}`, `Activity{lastCommitDate?,isActive,daysSinceLastCommit,commitsInLastWeek,...}`.
- `lib/models/scan_result.dart` — `ScanResult{projects:List<Project>, scannedAt?, summary:ScanSummary{total,averageReadiness}}`.
- `lib/data/snapshot_database.dart` — Drift `SnapshotDatabase`, `Snapshots` 테이블.
- `lib/data/snapshot_repository.dart` — `SnapshotRepository{ saveSnapshot, latest():Future<ScanResult?>, history():Future<List<ScanResult>> }`.
- `lib/providers.dart` — `databaseProvider`(현재 `NativeDatabase.memory()`), `repositoryProvider`, `dataSourceProvider`, `latestSnapshotProvider:FutureProvider<ScanResult?>`.
- `lib/main.dart` — `PtMobileApp`(MaterialApp), `HomeScreen`(import FAB + "프로젝트 N개"/빈 상태).

---

## File Structure

| 파일 | 책임 |
|------|------|
| `lib/data/database_connection.dart` | (신규) 파일 영속 Drift 연결 생성 헬퍼 |
| `lib/providers.dart` | (수정) `databaseProvider`를 파일 연결로 전환 |
| `lib/dashboard/dashboard_stats.dart` | (신규) `ScanResult` → 화면용 수치 순수 계산 |
| `lib/dashboard/summary_cards.dart` | (신규) 총계/평균 카드 위젯 |
| `lib/dashboard/priority_distribution.dart` | (신규) 우선순위 분포 막대 차트 위젯 |
| `lib/dashboard/activity_chart.dart` | (신규) 최근 활동 막대 차트 위젯 |
| `lib/dashboard/dashboard_screen.dart` | (신규) 위 3개를 조립 + 빈 상태 |
| `lib/main.dart` | (수정) home을 `DashboardScreen`으로, import FAB는 Dashboard로 이동 |
| `test/dashboard/dashboard_stats_test.dart` | 순수 계산 단위 테스트 |
| `test/dashboard/dashboard_screen_test.dart` | 화면 위젯 테스트 (빈 상태 + 데이터 상태) |

---

## Task 1: 파일 영속 DB로 전환

**Files:**
- Create: `lib/data/database_connection.dart`
- Modify: `lib/providers.dart`
- Test: `test/data/persistent_db_test.dart`

- [ ] **Step 1: Write the failing test**

`test/data/persistent_db_test.dart`:
```dart
import 'package:drift/drift.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/data/database_connection.dart';

void main() {
  test('openConnection returns a usable lazy executor', () async {
    // In-memory mode must work without platform path_provider plugins.
    final exec = openConnection(inMemory: true);
    expect(exec, isA<QueryExecutor>());
    await exec.close();
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/data/persistent_db_test.dart`
Expected: FAIL — `database_connection.dart` 없음.

- [ ] **Step 3: Implement `lib/data/database_connection.dart`**

```dart
import 'dart:io';
import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Opens the app's Drift executor.
///
/// Production: a file-backed SQLite database in the app documents directory so
/// imported snapshots survive restarts. Tests pass [inMemory] = true to get a
/// throwaway database with no platform plugin dependency.
QueryExecutor openConnection({bool inMemory = false}) {
  if (inMemory) {
    return NativeDatabase.memory();
  }
  return LazyDatabase(() async {
    final dir = await getApplicationDocumentsDirectory();
    final file = File(p.join(dir.path, 'pt_mobile_snapshots.sqlite'));
    return NativeDatabase.createInBackground(file);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/data/persistent_db_test.dart`
Expected: PASS (1 test).

- [ ] **Step 5: Switch `databaseProvider` to the file connection**

In `lib/providers.dart`, change the import block and `databaseProvider` only. Replace:
```dart
import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'data/scan_data_source.dart';
import 'data/snapshot_database.dart';
import 'data/snapshot_repository.dart';
import 'models/scan_result.dart';

/// In-memory database for the foundation. The Dashboard plan replaces this
/// with a persistent file-backed database (via path_provider).
final databaseProvider = Provider<SnapshotDatabase>((ref) {
  final db = SnapshotDatabase(NativeDatabase.memory());
  ref.onDispose(db.close);
  return db;
});
```
with:
```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'data/database_connection.dart';
import 'data/scan_data_source.dart';
import 'data/snapshot_database.dart';
import 'data/snapshot_repository.dart';
import 'models/scan_result.dart';

/// File-backed database so imported snapshots persist across restarts.
/// Tests override this provider with an in-memory database.
final databaseProvider = Provider<SnapshotDatabase>((ref) {
  final db = SnapshotDatabase(openConnection());
  ref.onDispose(db.close);
  return db;
});
```
(Leave `repositoryProvider`, `dataSourceProvider`, `latestSnapshotProvider` unchanged.)

- [ ] **Step 6: Run full suite + analyze**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test && flutter analyze`
Expected: all existing tests still PASS (widget tests already construct their own `ProviderContainer`; they will now hit the file DB unless overridden — see Step 7), `No issues found!`.

- [ ] **Step 7: Override the DB in existing widget tests**

`test/widget_import_test.dart` builds `ProviderContainer()` with no overrides; with a file-backed default it would touch the real filesystem/plugins and may fail. Make both tests deterministic by overriding `databaseProvider` with in-memory. In `test/widget_import_test.dart`, replace each `final container = ProviderContainer();` with:
```dart
final container = ProviderContainer(overrides: [
  databaseProvider.overrideWith((ref) {
    final db = SnapshotDatabase(openConnection(inMemory: true));
    ref.onDispose(db.close);
    return db;
  }),
]);
```
and add these imports at the top of the file:
```dart
import 'package:pt_mobile/data/database_connection.dart';
import 'package:pt_mobile/data/snapshot_database.dart';
```

- [ ] **Step 8: Run full suite again**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test`
Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add -A && git commit -m "feat: persist snapshots in a file-backed Drift database"
```

---

## Task 2: DashboardStats (순수 계산)

**Files:**
- Create: `lib/dashboard/dashboard_stats.dart`
- Test: `test/dashboard/dashboard_stats_test.dart`

- [ ] **Step 1: Write the failing test**

`test/dashboard/dashboard_stats_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/dashboard/dashboard_stats.dart';
import 'package:pt_mobile/models/project.dart';
import 'package:pt_mobile/models/scan_result.dart';

Project proj({
  String id = 'p',
  Priority priority = Priority.low,
  int readiness = 0,
  int progress = 0,
  int daysSinceLastCommit = 0,
  bool isActive = false,
}) =>
    Project(
      id: id,
      name: id,
      priority: priority,
      readiness: readiness,
      progress: Progress(percentage: progress),
      activity: Activity(
        isActive: isActive,
        daysSinceLastCommit: daysSinceLastCommit,
      ),
    );

void main() {
  test('empty scan yields zeroed stats', () {
    final s = DashboardStats.fromScan(ScanResult(projects: const []));
    expect(s.total, 0);
    expect(s.averageReadiness, 0);
    expect(s.averageProgress, 0);
    expect(s.activeCount, 0);
    expect(s.priorityCounts[Priority.critical], 0);
  });

  test('counts, averages and active count are computed', () {
    final s = DashboardStats.fromScan(ScanResult(projects: [
      proj(id: 'a', priority: Priority.critical, readiness: 80, progress: 90, isActive: true),
      proj(id: 'b', priority: Priority.critical, readiness: 40, progress: 50),
      proj(id: 'c', priority: Priority.low, readiness: 60, progress: 10, isActive: true),
    ]));
    expect(s.total, 3);
    expect(s.priorityCounts[Priority.critical], 2);
    expect(s.priorityCounts[Priority.low], 1);
    expect(s.priorityCounts[Priority.high], 0);
    expect(s.averageReadiness, 60); // (80+40+60)/3
    expect(s.averageProgress, 50); // (90+50+10)/3
    expect(s.activeCount, 2);
  });

  test('activity buckets group projects by staleness', () {
    final s = DashboardStats.fromScan(ScanResult(projects: [
      proj(id: 'fresh', daysSinceLastCommit: 2),
      proj(id: 'week', daysSinceLastCommit: 10),
      proj(id: 'month', daysSinceLastCommit: 20),
      proj(id: 'stale', daysSinceLastCommit: 90),
    ]));
    // buckets: <=7, <=14, <=30, >30
    expect(s.activityBuckets, [1, 1, 1, 1]);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/dashboard/dashboard_stats_test.dart`
Expected: FAIL — `dashboard_stats.dart` 없음.

- [ ] **Step 3: Implement `lib/dashboard/dashboard_stats.dart`**

```dart
import '../models/project.dart';
import '../models/scan_result.dart';

/// Pure, testable view-model for the Dashboard screen.
class DashboardStats {
  final int total;
  final int averageReadiness;
  final int averageProgress;
  final int activeCount;
  final Map<Priority, int> priorityCounts;

  /// Counts of projects by days-since-last-commit bucket:
  /// index 0: <=7, 1: 8-14, 2: 15-30, 3: >30.
  final List<int> activityBuckets;

  DashboardStats({
    required this.total,
    required this.averageReadiness,
    required this.averageProgress,
    required this.activeCount,
    required this.priorityCounts,
    required this.activityBuckets,
  });

  factory DashboardStats.fromScan(ScanResult scan) {
    final projects = scan.projects;
    final counts = {for (final p in Priority.values) p: 0};
    final buckets = [0, 0, 0, 0];
    var readinessSum = 0;
    var progressSum = 0;
    var active = 0;

    for (final pr in projects) {
      counts[pr.priority] = (counts[pr.priority] ?? 0) + 1;
      readinessSum += pr.readiness;
      progressSum += pr.progress?.percentage ?? 0;
      if (pr.activity?.isActive ?? false) active++;
      final days = pr.activity?.daysSinceLastCommit ?? 0;
      if (days <= 7) {
        buckets[0]++;
      } else if (days <= 14) {
        buckets[1]++;
      } else if (days <= 30) {
        buckets[2]++;
      } else {
        buckets[3]++;
      }
    }

    final n = projects.length;
    return DashboardStats(
      total: n,
      averageReadiness: n == 0 ? 0 : (readinessSum / n).round(),
      averageProgress: n == 0 ? 0 : (progressSum / n).round(),
      activeCount: active,
      priorityCounts: counts,
      activityBuckets: buckets,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/dashboard/dashboard_stats_test.dart`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/dashboard/dashboard_stats.dart test/dashboard/dashboard_stats_test.dart && git commit -m "feat: DashboardStats pure view-model"
```

---

## Task 3: 통계 카드 위젯

**Files:**
- Create: `lib/dashboard/summary_cards.dart`
- Test: `test/dashboard/summary_cards_test.dart`

- [ ] **Step 1: Write the failing test**

`test/dashboard/summary_cards_test.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/dashboard/dashboard_stats.dart';
import 'package:pt_mobile/dashboard/summary_cards.dart';
import 'package:pt_mobile/models/project.dart';
import 'package:pt_mobile/models/scan_result.dart';

void main() {
  testWidgets('renders total, averages and active count', (tester) async {
    final stats = DashboardStats.fromScan(ScanResult(projects: [
      Project(id: 'a', name: 'a', readiness: 80, progress: Progress(percentage: 90), activity: Activity(isActive: true)),
      Project(id: 'b', name: 'b', readiness: 40, progress: Progress(percentage: 50)),
    ]));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SummaryCards(stats: stats))));
    expect(find.text('2'), findsWidgets); // total and/or active
    expect(find.textContaining('60'), findsWidgets); // avg readiness
    expect(find.text('프로젝트'), findsOneWidget);
    expect(find.text('평균 준비도'), findsOneWidget);
    expect(find.text('활성'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/dashboard/summary_cards_test.dart`
Expected: FAIL — `summary_cards.dart` 없음.

- [ ] **Step 3: Implement `lib/dashboard/summary_cards.dart`**

```dart
import 'package:flutter/material.dart';
import 'dashboard_stats.dart';

class SummaryCards extends StatelessWidget {
  final DashboardStats stats;
  const SummaryCards({super.key, required this.stats});

  @override
  Widget build(BuildContext context) {
    final cards = <Widget>[
      _StatCard(label: '프로젝트', value: '${stats.total}'),
      _StatCard(label: '평균 준비도', value: '${stats.averageReadiness}'),
      _StatCard(label: '평균 진행률', value: '${stats.averageProgress}%'),
      _StatCard(label: '활성', value: '${stats.activeCount}'),
    ];
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      childAspectRatio: 2.4,
      children: cards,
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  const _StatCard({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(value, style: theme.textTheme.headlineSmall),
            const SizedBox(height: 4),
            Text(label, style: theme.textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/dashboard/summary_cards_test.dart`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/dashboard/summary_cards.dart test/dashboard/summary_cards_test.dart && git commit -m "feat: dashboard summary cards"
```

---

## Task 4: fl_chart 도입 + 우선순위 분포 차트

**Files:**
- Modify: `pubspec.yaml`
- Create: `lib/dashboard/priority_distribution.dart`
- Test: `test/dashboard/priority_distribution_test.dart`

- [ ] **Step 1: Add fl_chart dependency**

In `pubspec.yaml` under `dependencies:` add:
```yaml
  fl_chart: ^0.69.0
```
Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter pub get`
Expected: `Got dependencies!`. If `^0.69.0` cannot resolve, relax to the latest version `flutter pub get` accepts and note it.

- [ ] **Step 2: Write the failing test**

`test/dashboard/priority_distribution_test.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/dashboard/dashboard_stats.dart';
import 'package:pt_mobile/dashboard/priority_distribution.dart';
import 'package:pt_mobile/models/project.dart';
import 'package:pt_mobile/models/scan_result.dart';

void main() {
  testWidgets('renders a title and builds without error', (tester) async {
    final stats = DashboardStats.fromScan(ScanResult(projects: [
      Project(id: 'a', name: 'a', priority: Priority.critical),
      Project(id: 'b', name: 'b', priority: Priority.low),
    ]));
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: PriorityDistribution(stats: stats)),
    ));
    expect(find.text('우선순위 분포'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/dashboard/priority_distribution_test.dart`
Expected: FAIL — `priority_distribution.dart` 없음.

- [ ] **Step 4: Implement `lib/dashboard/priority_distribution.dart`**

```dart
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import '../models/project.dart';
import 'dashboard_stats.dart';

class PriorityDistribution extends StatelessWidget {
  final DashboardStats stats;
  const PriorityDistribution({super.key, required this.stats});

  static const _labels = {
    Priority.critical: 'CRIT',
    Priority.high: 'HIGH',
    Priority.medium: 'MED',
    Priority.low: 'LOW',
  };

  @override
  Widget build(BuildContext context) {
    final order = [Priority.critical, Priority.high, Priority.medium, Priority.low];
    final maxCount = stats.priorityCounts.values.fold<int>(0, (a, b) => a > b ? a : b);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('우선순위 분포', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        SizedBox(
          height: 160,
          child: BarChart(BarChartData(
            maxY: (maxCount == 0 ? 1 : maxCount).toDouble(),
            barGroups: [
              for (var i = 0; i < order.length; i++)
                BarChartGroupData(x: i, barRods: [
                  BarChartRodData(toY: (stats.priorityCounts[order[i]] ?? 0).toDouble()),
                ]),
            ],
            titlesData: FlTitlesData(
              leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              bottomTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  getTitlesWidget: (value, meta) {
                    final i = value.toInt();
                    final label = i >= 0 && i < order.length ? _labels[order[i]]! : '';
                    return Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(label, style: const TextStyle(fontSize: 10)),
                    );
                  },
                ),
              ),
            ),
            borderData: FlBorderData(show: false),
            gridData: const FlGridData(show: false),
          )),
        ),
      ],
    );
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/dashboard/priority_distribution_test.dart`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add pubspec.yaml pubspec.lock lib/dashboard/priority_distribution.dart test/dashboard/priority_distribution_test.dart && git commit -m "feat: priority distribution chart with fl_chart"
```

---

## Task 5: 최근 활동 차트

**Files:**
- Create: `lib/dashboard/activity_chart.dart`
- Test: `test/dashboard/activity_chart_test.dart`

- [ ] **Step 1: Write the failing test**

`test/dashboard/activity_chart_test.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/dashboard/activity_chart.dart';
import 'package:pt_mobile/dashboard/dashboard_stats.dart';
import 'package:pt_mobile/models/project.dart';
import 'package:pt_mobile/models/scan_result.dart';

void main() {
  testWidgets('renders title and builds without error', (tester) async {
    final stats = DashboardStats.fromScan(ScanResult(projects: [
      Project(id: 'a', name: 'a', activity: Activity(daysSinceLastCommit: 2)),
      Project(id: 'b', name: 'b', activity: Activity(daysSinceLastCommit: 90)),
    ]));
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: ActivityChart(stats: stats)),
    ));
    expect(find.text('최근 활동'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/dashboard/activity_chart_test.dart`
Expected: FAIL — `activity_chart.dart` 없음.

- [ ] **Step 3: Implement `lib/dashboard/activity_chart.dart`**

```dart
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'dashboard_stats.dart';

class ActivityChart extends StatelessWidget {
  final DashboardStats stats;
  const ActivityChart({super.key, required this.stats});

  static const _labels = ['~7d', '~14d', '~30d', '30d+'];

  @override
  Widget build(BuildContext context) {
    final buckets = stats.activityBuckets;
    final maxCount = buckets.fold<int>(0, (a, b) => a > b ? a : b);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('최근 활동', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        SizedBox(
          height: 160,
          child: BarChart(BarChartData(
            maxY: (maxCount == 0 ? 1 : maxCount).toDouble(),
            barGroups: [
              for (var i = 0; i < buckets.length; i++)
                BarChartGroupData(x: i, barRods: [
                  BarChartRodData(toY: buckets[i].toDouble()),
                ]),
            ],
            titlesData: FlTitlesData(
              leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              bottomTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  getTitlesWidget: (value, meta) {
                    final i = value.toInt();
                    final label = i >= 0 && i < _labels.length ? _labels[i] : '';
                    return Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(label, style: const TextStyle(fontSize: 10)),
                    );
                  },
                ),
              ),
            ),
            borderData: FlBorderData(show: false),
            gridData: const FlGridData(show: false),
          )),
        ),
      ],
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/dashboard/activity_chart_test.dart`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/dashboard/activity_chart.dart test/dashboard/activity_chart_test.dart && git commit -m "feat: recent activity chart"
```

---

## Task 6: DashboardScreen 조립 + 빈 상태 + home 교체

**Files:**
- Create: `lib/dashboard/dashboard_screen.dart`
- Modify: `lib/main.dart`
- Test: `test/dashboard/dashboard_screen_test.dart`

- [ ] **Step 1: Write the failing test**

`test/dashboard/dashboard_screen_test.dart`:
```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/data/database_connection.dart';
import 'package:pt_mobile/data/snapshot_database.dart';
import 'package:pt_mobile/dashboard/dashboard_screen.dart';
import 'package:pt_mobile/providers.dart';

ProviderContainer memContainer() => ProviderContainer(overrides: [
      databaseProvider.overrideWith((ref) {
        final db = SnapshotDatabase(openConnection(inMemory: true));
        ref.onDispose(db.close);
        return db;
      }),
    ]);

void main() {
  testWidgets('shows empty state when no snapshot', (tester) async {
    final container = memContainer();
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: const DashboardApp(),
    ));
    await tester.pumpAndSettle();
    expect(find.textContaining('가져오'), findsOneWidget); // import 안내
  });

  testWidgets('shows summary and charts after import', (tester) async {
    final container = memContainer();
    addTearDown(container.dispose);
    await container.read(repositoryProvider).saveSnapshot(
        '{"projects":[{"id":"a","name":"a","priority":"CRITICAL","readiness":80,"progress":{"percentage":90},"activity":{"isActive":true,"daysSinceLastCommit":2}},{"id":"b","name":"b","priority":"LOW","readiness":40,"progress":{"percentage":50},"activity":{"daysSinceLastCommit":90}}]}');
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: const DashboardApp(),
    ));
    await tester.pumpAndSettle();
    expect(find.text('프로젝트'), findsOneWidget);
    expect(find.text('우선순위 분포'), findsOneWidget);
    expect(find.text('최근 활동'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/dashboard/dashboard_screen_test.dart`
Expected: FAIL — `dashboard_screen.dart` / `DashboardApp` 없음.

- [ ] **Step 3: Implement `lib/dashboard/dashboard_screen.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:file_picker/file_picker.dart';
import '../data/scan_data_source.dart';
import '../providers.dart';
import 'activity_chart.dart';
import 'dashboard_stats.dart';
import 'priority_distribution.dart';
import 'summary_cards.dart';

/// Test/host entry that mounts just the dashboard under a MaterialApp.
class DashboardApp extends StatelessWidget {
  const DashboardApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'PT Mobile',
        theme: ThemeData(useMaterial3: true),
        home: const DashboardScreen(),
      );
}

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  Future<void> _import(BuildContext context, WidgetRef ref) async {
    final picked = await FilePicker.platform
        .pickFiles(type: FileType.custom, allowedExtensions: ['json']);
    final path = picked?.files.single.path;
    if (path == null) return;
    try {
      final raw = await ref.read(dataSourceProvider).loadRawFromPath(path);
      await ref.read(repositoryProvider).saveSnapshot(raw);
      ref.invalidate(latestSnapshotProvider);
    } on ScanLoadException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final latest = ref.watch(latestSnapshotProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Dashboard')),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _import(context, ref),
        child: const Icon(Icons.file_upload),
      ),
      body: latest.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('오류: $e')),
        data: (scan) {
          if (scan == null || scan.projects.isEmpty) {
            return const Center(
              child: Text('스캔 결과를 가져오세요 (우하단 버튼)'),
            );
          }
          final stats = DashboardStats.fromScan(scan);
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              SummaryCards(stats: stats),
              const SizedBox(height: 24),
              PriorityDistribution(stats: stats),
              const SizedBox(height: 24),
              ActivityChart(stats: stats),
            ],
          );
        },
      ),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/dashboard/dashboard_screen_test.dart`
Expected: PASS (2 tests).

- [ ] **Step 5: Point `main.dart` at the Dashboard**

In `lib/main.dart`, change the app's `home` to `DashboardScreen` and drop the now-redundant `HomeScreen`. Replace the whole file with:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'dashboard/dashboard_screen.dart';

void main() => runApp(const ProviderScope(child: PtMobileApp()));

class PtMobileApp extends StatelessWidget {
  const PtMobileApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'PT Mobile',
        theme: ThemeData(useMaterial3: true),
        home: const DashboardScreen(),
      );
}
```

- [ ] **Step 6: Update the old import widget test for the new home**

`test/widget_import_test.dart` references `HomeScreen`/`PtMobileApp` body text ("프로젝트 N개"/"없음") that no longer exists. Delete this file — its behavior (import + empty/data states) is now covered by `test/dashboard/dashboard_screen_test.dart`:
```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git rm test/widget_import_test.dart
```

- [ ] **Step 7: Run full suite + analyze**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test && flutter analyze`
Expected: all tests PASS, `No issues found!`.

- [ ] **Step 8: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add -A && git commit -m "feat: Dashboard screen with summary, charts and empty state"
```

---

## Self-Review 메모

- **스펙 §5.1 커버리지:** 전체 통계 카드(Task 3) / 우선순위 분포(Task 4) / 최근 활동 그래프(Task 5) / 빈 상태(Task 6 Step 3) / §10 "영속 DB 전환·fl_chart 도입"(Task 1, 4) 모두 태스크 존재.
- **타입 일관성:** `DashboardStats{total, averageReadiness, averageProgress, activeCount, priorityCounts:Map<Priority,int>, activityBuckets:List<int>}`를 Task 2에서 정의하고 Task 3·4·5·6에서 동일 시그니처로 소비. `openConnection({inMemory})`는 Task 1 정의 후 Task 6 테스트에서 재사용. 기존 `Project`/`Progress`/`Activity`/`ScanResult` 생성자 시그니처는 토대 코드와 일치.
- **테스트 정직성:** 차트 위젯은 캔버스라 픽셀 대신 "제목 존재 + 예외 없음(takeException)"만 검증; 핵심 수치 로직은 `DashboardStats` 순수 테스트로 강하게 검증.
- **회귀 주의:** Task 1에서 기본 DB가 파일 연결로 바뀌므로 기존 위젯 테스트에 in-memory override를 주입(Step 7). Task 6에서 옛 import 테스트는 Dashboard 테스트로 대체·삭제.
- **연기(YAGNI):** 추천/추세/알림은 후속 플랜. Dashboard는 최신 스냅샷 1장만 사용(히스토리는 Trends에서).
```
