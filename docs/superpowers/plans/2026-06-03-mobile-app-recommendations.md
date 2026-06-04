# 모바일 앱 Recommendations 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 온디바이스 투명 스코어링으로 "오늘의 추천" 상위 N개와 "잊힌 프로젝트"를 계산해 보여주고, 추천을 탭/무시하면 그 신호를 로컬에 누적해 가중치를 소폭 조정한다.

**Architecture:** 순수 함수 `RecommendationEngine.score(project, weights)`가 우선순위·완료근접·정체·준비도·이슈 항을 가중합한다(스펙 §7). `RecommendationWeights`는 기본 상수이며, 사용자 상호작용 카운트(`InteractionStore`, shared_preferences)로 소폭 조정된다. 화면은 점수 상위 추천을 스와이프 카드로, 30일+ 정체 프로젝트를 "잊힌 프로젝트"로 렌더링한다. Recommendations 탭을 HomeShell에 추가.

**Tech Stack:** Flutter, Riverpod, shared_preferences, flutter_test.

> **앱 위치:** `/Users/jean325/portfolio/projects/pt-mobile/`. 모든 경로는 이 디렉토리 기준.
>
> **환경:** Flutter/Dart는 PATH에 없다. 모든 명령 앞에 같은 줄에서 `export PATH="$PATH:/Users/jean325/development/flutter/bin" && ` 를 붙인다. Dart 3.11.5.

## 기존 코드 (이미 존재)

- `lib/models/project.dart` — `Project{id,name,priority(Priority enum),readiness,progress?(Progress{percentage}),activity?(Activity{isActive,daysSinceLastCommit}),issues,...}`.
- `lib/providers.dart` — `latestSnapshotProvider:FutureProvider<ScanResult?>`, `repositoryProvider`, `databaseProvider`.
- `lib/data/database_connection.dart` — `openConnection({inMemory})`.
- `lib/projects/projects_screen.dart`, `lib/dashboard/dashboard_screen.dart` — 자체 Scaffold/AppBar 보유.
- `lib/shell/home_shell.dart` — `HomeShell`(StatefulWidget): `_index`로 화면 선택, NavigationBar destinations 2개(Dashboard/Projects). 활성 화면만 마운트.
- 테스트 패턴: `ProviderContainer(overrides:[databaseProvider.overrideWith(...openConnection(inMemory:true)...)])` + `UncontrolledProviderScope`. shared_preferences는 테스트에서 `SharedPreferences.setMockInitialValues({})` 사용.
- `pubspec.yaml`: `shared_preferences`는 이미 의존성에 있음(없으면 Task 0에서 추가). 확인: 있음.

---

## File Structure

| 파일 | 책임 |
|------|------|
| `lib/recommendations/recommendation_weights.dart` | (신규) 가중치 상수 + 조정 |
| `lib/recommendations/recommendation_engine.dart` | (신규) `score()` 순수 함수 + 추천/잊힌 목록 산출 |
| `lib/recommendations/interaction_store.dart` | (신규) 탭/무시 카운트 영속(shared_preferences) |
| `lib/recommendations/recommendation_providers.dart` | (신규) interactionStore/weights/recommendations providers |
| `lib/recommendations/recommendation_card.dart` | (신규) 추천 1건 카드(스와이프) |
| `lib/recommendations/recommendations_screen.dart` | (신규) 오늘의 추천 + 잊힌 프로젝트 |
| `lib/shell/home_shell.dart` | (수정) Recommendations 탭 추가 |
| `test/recommendations/recommendation_engine_test.dart` | 스코어링 단위 테스트 |
| `test/recommendations/interaction_store_test.dart` | 영속 테스트 |
| `test/recommendations/recommendations_screen_test.dart` | 화면 테스트 |
| `test/shell/home_shell_test.dart` | (수정) 3탭 전환 |

---

## Task 1: RecommendationWeights

**Files:**
- Create: `lib/recommendations/recommendation_weights.dart`
- Test: `test/recommendations/recommendation_weights_test.dart`

- [ ] **Step 1: Write the failing test**

`test/recommendations/recommendation_weights_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/recommendations/recommendation_weights.dart';

void main() {
  test('defaults are all positive', () {
    const w = RecommendationWeights.defaults;
    expect(w.priority, greaterThan(0));
    expect(w.proximity, greaterThan(0));
    expect(w.staleness, greaterThan(0));
    expect(w.readiness, greaterThan(0));
    expect(w.issues, greaterThan(0));
  });

  test('adjusted nudges proximity up on taps and down on dismissals, clamped', () {
    const w = RecommendationWeights.defaults;
    final up = w.adjusted(taps: 10, dismissals: 0);
    final down = w.adjusted(taps: 0, dismissals: 10);
    expect(up.proximity, greaterThan(w.proximity));
    expect(down.proximity, lessThan(w.proximity));
    // clamped to a sane band (never negative, never runaway)
    final extreme = w.adjusted(taps: 100000, dismissals: 0);
    expect(extreme.proximity, lessThanOrEqualTo(w.proximity * 2));
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/recommendations/recommendation_weights_test.dart`
Expected: FAIL — file 없음.

- [ ] **Step 3: Implement `lib/recommendations/recommendation_weights.dart`**

```dart
/// Tunable weights for the recommendation score. All positive.
class RecommendationWeights {
  final double priority;
  final double proximity; // closeness to completion (90s)
  final double staleness; // nudge to revive stalled work
  final double readiness;
  final double issues; // penalty magnitude

  const RecommendationWeights({
    required this.priority,
    required this.proximity,
    required this.staleness,
    required this.readiness,
    required this.issues,
  });

  static const defaults = RecommendationWeights(
    priority: 1.0,
    proximity: 1.0,
    staleness: 0.6,
    readiness: 0.4,
    issues: 0.5,
  );

  /// Lightweight on-device "learning": taps raise the proximity weight,
  /// dismissals lower it, bounded to [0.5x, 2x] of the base so feedback can
  /// never make the score degenerate.
  RecommendationWeights adjusted({required int taps, required int dismissals}) {
    final net = taps - dismissals;
    // saturating factor in [-0.5, +1.0]
    final raw = net / 20.0;
    final factor = raw.clamp(-0.5, 1.0);
    final newProximity = proximity * (1.0 + factor);
    return RecommendationWeights(
      priority: priority,
      proximity: newProximity,
      staleness: staleness,
      readiness: readiness,
      issues: issues,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/recommendations/recommendation_weights_test.dart`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/recommendations/recommendation_weights.dart test/recommendations/recommendation_weights_test.dart && git commit -m "feat: RecommendationWeights with bounded on-device adjustment"
```

---

## Task 2: RecommendationEngine (스코어링 순수 함수)

**Files:**
- Create: `lib/recommendations/recommendation_engine.dart`
- Test: `test/recommendations/recommendation_engine_test.dart`

- [ ] **Step 1: Write the failing test**

`test/recommendations/recommendation_engine_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/models/project.dart';
import 'package:pt_mobile/recommendations/recommendation_engine.dart';
import 'package:pt_mobile/recommendations/recommendation_weights.dart';

Project proj({
  String name = 'x',
  Priority priority = Priority.low,
  int readiness = 0,
  int progress = 0,
  int days = 0,
  List<String> issues = const [],
  bool hasActivity = true,
}) =>
    Project(
      id: name,
      name: name,
      priority: priority,
      readiness: readiness,
      progress: Progress(percentage: progress),
      activity: hasActivity ? Activity(daysSinceLastCommit: days) : null,
      issues: issues,
    );

void main() {
  const w = RecommendationWeights.defaults;

  test('higher priority scores higher, all else equal', () {
    final hi = RecommendationEngine.score(proj(priority: Priority.critical), w);
    final lo = RecommendationEngine.score(proj(priority: Priority.low), w);
    expect(hi, greaterThan(lo));
  });

  test('near-completion (90s) scores higher than mid progress', () {
    final near = RecommendationEngine.score(proj(progress: 95), w);
    final mid = RecommendationEngine.score(proj(progress: 50), w);
    expect(near, greaterThan(mid));
  });

  test('issues reduce the score', () {
    final clean = RecommendationEngine.score(proj(progress: 90), w);
    final dirty = RecommendationEngine.score(proj(progress: 90, issues: ['x', 'y']), w);
    expect(dirty, lessThan(clean));
  });

  test('recommend returns top N by score, descending', () {
    final projects = [
      proj(name: 'low', priority: Priority.low, progress: 10),
      proj(name: 'critnear', priority: Priority.critical, progress: 95),
      proj(name: 'mid', priority: Priority.medium, progress: 50),
    ];
    final top = RecommendationEngine.recommend(projects, w, limit: 2);
    expect(top.map((e) => e.project.name), ['critnear', 'mid']);
    expect(top.first.score, greaterThan(top.last.score));
  });

  test('forgotten returns projects stalled beyond threshold, most-stale first', () {
    final projects = [
      proj(name: 'fresh', days: 3),
      proj(name: 'old', days: 40),
      proj(name: 'ancient', days: 120),
      proj(name: 'unknown', hasActivity: false),
    ];
    final forgotten = RecommendationEngine.forgotten(projects, thresholdDays: 30);
    expect(forgotten.map((e) => e.name), ['ancient', 'old']);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/recommendations/recommendation_engine_test.dart`
Expected: FAIL — file 없음.

- [ ] **Step 3: Implement `lib/recommendations/recommendation_engine.dart`**

```dart
import '../models/project.dart';
import 'recommendation_weights.dart';

/// A scored recommendation (project + its computed score).
class ScoredProject {
  final Project project;
  final double score;
  const ScoredProject(this.project, this.score);
}

class RecommendationEngine {
  RecommendationEngine._();

  static double _priorityFactor(Priority p) {
    switch (p) {
      case Priority.critical:
        return 1.0;
      case Priority.high:
        return 0.75;
      case Priority.medium:
        return 0.5;
      case Priority.low:
        return 0.25;
    }
  }

  /// Peaks near 90% completion (closing-the-loop nudge), 0 at 0% and 100%.
  static double _proximityFactor(int progress) {
    if (progress <= 0 || progress >= 100) return 0;
    // triangular peak at 90
    if (progress <= 90) return progress / 90.0;
    return (100 - progress) / 10.0;
  }

  static double _stalenessFactor(Project p) {
    final days = p.activity?.daysSinceLastCommit;
    if (days == null) return 0.5; // unknown → mild nudge
    if (days <= 3) return 0.0; // freshly active: no nudge needed
    if (days >= 60) return 1.0;
    return (days - 3) / 57.0;
  }

  static double score(Project p, RecommendationWeights w) {
    final base = w.priority * _priorityFactor(p.priority) +
        w.proximity * _proximityFactor(p.progress?.percentage ?? 0) +
        w.staleness * _stalenessFactor(p) +
        w.readiness * ((p.readiness) / 100.0);
    final penalty = w.issues * (p.issues.length.clamp(0, 5) / 5.0);
    return base - penalty;
  }

  static List<ScoredProject> recommend(
    List<Project> projects,
    RecommendationWeights w, {
    int limit = 5,
  }) {
    final scored = projects.map((p) => ScoredProject(p, score(p, w))).toList()
      ..sort((a, b) => b.score.compareTo(a.score));
    return scored.take(limit).toList();
  }

  static List<Project> forgotten(
    List<Project> projects, {
    int thresholdDays = 30,
  }) {
    final stale = projects
        .where((p) => (p.activity?.daysSinceLastCommit ?? -1) >= thresholdDays)
        .toList()
      ..sort((a, b) => (b.activity!.daysSinceLastCommit)
          .compareTo(a.activity!.daysSinceLastCommit));
    return stale;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/recommendations/recommendation_engine_test.dart`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/recommendations/recommendation_engine.dart test/recommendations/recommendation_engine_test.dart && git commit -m "feat: RecommendationEngine transparent scoring"
```

---

## Task 3: InteractionStore (탭/무시 영속)

**Files:**
- Create: `lib/recommendations/interaction_store.dart`
- Test: `test/recommendations/interaction_store_test.dart`

- [ ] **Step 1: Write the failing test**

`test/recommendations/interaction_store_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/recommendations/interaction_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('starts at zero and accumulates taps and dismissals', () async {
    final prefs = await SharedPreferences.getInstance();
    final store = InteractionStore(prefs);
    expect(store.taps, 0);
    expect(store.dismissals, 0);

    await store.recordTap();
    await store.recordTap();
    await store.recordDismissal();

    expect(store.taps, 2);
    expect(store.dismissals, 1);
  });

  test('persists across new store instances on the same prefs', () async {
    final prefs = await SharedPreferences.getInstance();
    await InteractionStore(prefs).recordTap();

    final reloaded = InteractionStore(prefs);
    expect(reloaded.taps, 1);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/recommendations/interaction_store_test.dart`
Expected: FAIL — file 없음.

- [ ] **Step 3: Implement `lib/recommendations/interaction_store.dart`**

```dart
import 'package:shared_preferences/shared_preferences.dart';

/// Persists how often the user taps vs. dismisses recommendations.
/// Used to nudge the scoring weights (bounded) over time.
class InteractionStore {
  static const _tapsKey = 'rec_taps';
  static const _dismissKey = 'rec_dismissals';

  final SharedPreferences _prefs;
  InteractionStore(this._prefs);

  int get taps => _prefs.getInt(_tapsKey) ?? 0;
  int get dismissals => _prefs.getInt(_dismissKey) ?? 0;

  Future<void> recordTap() => _prefs.setInt(_tapsKey, taps + 1);
  Future<void> recordDismissal() => _prefs.setInt(_dismissKey, dismissals + 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/recommendations/interaction_store_test.dart`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/recommendations/interaction_store.dart test/recommendations/interaction_store_test.dart && git commit -m "feat: InteractionStore for recommendation feedback"
```

---

## Task 4: Recommendation providers

**Files:**
- Create: `lib/recommendations/recommendation_providers.dart`
- Test: `test/recommendations/recommendation_providers_test.dart`

- [ ] **Step 1: Write the failing test**

`test/recommendations/recommendation_providers_test.dart`:
```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/recommendations/interaction_store.dart';
import 'package:pt_mobile/recommendations/recommendation_providers.dart';
import 'package:pt_mobile/recommendations/recommendation_weights.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('weightsProvider reflects interaction taps', () async {
    final prefs = await SharedPreferences.getInstance();
    final store = InteractionStore(prefs);
    await store.recordTap();
    await store.recordTap();

    final container = ProviderContainer(overrides: [
      interactionStoreProvider.overrideWithValue(store),
    ]);
    addTearDown(container.dispose);

    final w = container.read(weightsProvider);
    expect(w.proximity, greaterThan(RecommendationWeights.defaults.proximity));
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/recommendations/recommendation_providers_test.dart`
Expected: FAIL — file 없음.

- [ ] **Step 3: Implement `lib/recommendations/recommendation_providers.dart`**

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/scan_result.dart';
import '../providers.dart';
import 'interaction_store.dart';
import 'recommendation_engine.dart';
import 'recommendation_weights.dart';

/// Overridden at app start (and in tests) with a concrete InteractionStore.
final interactionStoreProvider = Provider<InteractionStore>((ref) {
  throw UnimplementedError('interactionStoreProvider must be overridden');
});

final weightsProvider = Provider<RecommendationWeights>((ref) {
  final store = ref.watch(interactionStoreProvider);
  return RecommendationWeights.defaults
      .adjusted(taps: store.taps, dismissals: store.dismissals);
});

final recommendationsProvider = Provider<List<ScoredProject>>((ref) {
  final scan = ref.watch(latestSnapshotProvider).valueOrNull;
  if (scan == null) return const [];
  return RecommendationEngine.recommend(scan.projects, ref.watch(weightsProvider), limit: 5);
});

final forgottenProvider = Provider<List<dynamic>>((ref) {
  final scan = ref.watch(latestSnapshotProvider).valueOrNull;
  if (scan == null) return const [];
  return RecommendationEngine.forgotten(scan.projects, thresholdDays: 30);
});
```

> 참고: `forgottenProvider`의 반환 타입은 `Provider<List<Project>>`가 더 정확하다. import 충돌을 피하기 위해 아래처럼 `Project`를 import해 명시한다. Step 3 코드의 `List<dynamic>`를 `List<Project>`로 바꾸고 `import '../models/project.dart';`를 추가하라(아래 최종형):

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/project.dart';
import '../providers.dart';
import 'interaction_store.dart';
import 'recommendation_engine.dart';
import 'recommendation_weights.dart';

final interactionStoreProvider = Provider<InteractionStore>((ref) {
  throw UnimplementedError('interactionStoreProvider must be overridden');
});

final weightsProvider = Provider<RecommendationWeights>((ref) {
  final store = ref.watch(interactionStoreProvider);
  return RecommendationWeights.defaults
      .adjusted(taps: store.taps, dismissals: store.dismissals);
});

final recommendationsProvider = Provider<List<ScoredProject>>((ref) {
  final scan = ref.watch(latestSnapshotProvider).valueOrNull;
  if (scan == null) return const [];
  return RecommendationEngine.recommend(scan.projects, ref.watch(weightsProvider), limit: 5);
});

final forgottenProvider = Provider<List<Project>>((ref) {
  final scan = ref.watch(latestSnapshotProvider).valueOrNull;
  if (scan == null) return const [];
  return RecommendationEngine.forgotten(scan.projects, thresholdDays: 30);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/recommendations/recommendation_providers_test.dart`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/recommendations/recommendation_providers.dart test/recommendations/recommendation_providers_test.dart && git commit -m "feat: recommendation providers (weights, recommendations, forgotten)"
```

---

## Task 5: RecommendationsScreen + 탭 추가 + 앱 초기화

**Files:**
- Create: `lib/recommendations/recommendations_screen.dart`
- Modify: `lib/shell/home_shell.dart`
- Modify: `lib/main.dart`
- Modify: `test/shell/home_shell_test.dart`
- Test: `test/recommendations/recommendations_screen_test.dart`

- [ ] **Step 1: Write the failing screen test**

`test/recommendations/recommendations_screen_test.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/data/database_connection.dart';
import 'package:pt_mobile/data/snapshot_database.dart';
import 'package:pt_mobile/providers.dart';
import 'package:pt_mobile/recommendations/interaction_store.dart';
import 'package:pt_mobile/recommendations/recommendation_providers.dart';
import 'package:pt_mobile/recommendations/recommendations_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));

  Future<ProviderContainer> container() async {
    final prefs = await SharedPreferences.getInstance();
    return ProviderContainer(overrides: [
      databaseProvider.overrideWith((ref) {
        final db = SnapshotDatabase(openConnection(inMemory: true));
        ref.onDispose(db.close);
        return db;
      }),
      interactionStoreProvider.overrideWithValue(InteractionStore(prefs)),
    ]);
  }

  testWidgets('empty state with no snapshot', (tester) async {
    final c = await container();
    addTearDown(c.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: c,
      child: const MaterialApp(home: RecommendationsScreen()),
    ));
    await tester.pumpAndSettle();
    expect(find.textContaining('가져오'), findsOneWidget);
  });

  testWidgets('shows today recommendations and forgotten section', (tester) async {
    final c = await container();
    addTearDown(c.dispose);
    await c.read(repositoryProvider).saveSnapshot(
        '{"projects":[{"id":"a","name":"critnear","priority":"CRITICAL","progress":{"percentage":95},"activity":{"daysSinceLastCommit":2}},{"id":"b","name":"ancient","priority":"LOW","activity":{"daysSinceLastCommit":120}}]}');
    await tester.pumpWidget(UncontrolledProviderScope(
      container: c,
      child: const MaterialApp(home: RecommendationsScreen()),
    ));
    await tester.pumpAndSettle();
    expect(find.text('오늘의 추천'), findsOneWidget);
    expect(find.text('잊힌 프로젝트'), findsOneWidget);
    expect(find.text('critnear'), findsWidgets);
    expect(find.text('ancient'), findsWidgets);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/recommendations/recommendations_screen_test.dart`
Expected: FAIL — `recommendations_screen.dart` 없음.

- [ ] **Step 3: Implement `lib/recommendations/recommendations_screen.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/project.dart';
import '../providers.dart';
import 'recommendation_providers.dart';

class RecommendationsScreen extends ConsumerWidget {
  const RecommendationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scan = ref.watch(latestSnapshotProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Recommendations')),
      body: scan.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('오류: $e')),
        data: (result) {
          if (result == null || result.projects.isEmpty) {
            return const Center(child: Text('스캔 결과를 가져오세요 (Dashboard 탭)'));
          }
          final recs = ref.watch(recommendationsProvider);
          final forgotten = ref.watch(forgottenProvider);
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('오늘의 추천', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              for (final r in recs)
                Dismissible(
                  key: ValueKey('rec_${r.project.id}'),
                  background: const ColoredBox(color: Color(0x11000000)),
                  onDismissed: (_) =>
                      ref.read(interactionStoreProvider).recordDismissal(),
                  child: Card(
                    child: ListTile(
                      title: Text(r.project.name),
                      subtitle: Text(
                          '점수 ${r.score.toStringAsFixed(2)} · 준비도 ${r.project.readiness}'),
                      onTap: () =>
                          ref.read(interactionStoreProvider).recordTap(),
                    ),
                  ),
                ),
              const SizedBox(height: 24),
              Text('잊힌 프로젝트', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              if (forgotten.isEmpty)
                const Text('정체된 프로젝트가 없습니다')
              else
                for (final Project p in forgotten)
                  ListTile(
                    dense: true,
                    title: Text(p.name),
                    trailing: Text('${p.activity?.daysSinceLastCommit ?? 0}일'),
                  ),
            ],
          );
        },
      ),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/recommendations/recommendations_screen_test.dart`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the Recommendations tab to `home_shell.dart`**

Replace the body selection and destinations in `lib/shell/home_shell.dart`:
```dart
import 'package:flutter/material.dart';
import '../dashboard/dashboard_screen.dart';
import '../projects/projects_screen.dart';
import '../recommendations/recommendations_screen.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  static const _screens = [
    DashboardScreen(),
    ProjectsScreen(),
    RecommendationsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _screens[_index],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard), label: 'Dashboard'),
          NavigationDestination(icon: Icon(Icons.list), label: 'Projects'),
          NavigationDestination(icon: Icon(Icons.recommend), label: 'Recommend'),
        ],
      ),
    );
  }
}
```

- [ ] **Step 6: Update `home_shell_test.dart` for the third tab**

Append a test to `test/shell/home_shell_test.dart` (keep existing test). Add the import:
```dart
import 'package:pt_mobile/recommendations/recommendations_screen.dart';
import 'package:pt_mobile/recommendations/interaction_store.dart';
import 'package:pt_mobile/recommendations/recommendation_providers.dart';
import 'package:shared_preferences/shared_preferences.dart';
```
Add inside `main()`:
```dart
  testWidgets('switches to Recommendations tab', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final c = ProviderContainer(overrides: [
      databaseProvider.overrideWith((ref) {
        final db = SnapshotDatabase(openConnection(inMemory: true));
        ref.onDispose(db.close);
        return db;
      }),
      interactionStoreProvider.overrideWithValue(InteractionStore(prefs)),
    ]);
    addTearDown(c.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: c,
      child: const MaterialApp(home: HomeShell()),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.recommend));
    await tester.pumpAndSettle();
    expect(find.byType(RecommendationsScreen), findsOneWidget);
  });
```
> 주의: 기존 첫 테스트의 `memContainer()`도 이제 `interactionStoreProvider` override가 필요하다(HomeShell이 RecommendationsScreen을 자식으로 들고 있어도, `_screens[_index]`가 0이면 Recommendations는 빌드되지 않으므로 첫 테스트는 override 없이 통과한다 — `_screens[_index]`만 마운트되기 때문). 변경 불필요.

- [ ] **Step 7: Initialize the InteractionStore override in `main.dart`**

Replace `lib/main.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'recommendations/interaction_store.dart';
import 'recommendations/recommendation_providers.dart';
import 'shell/home_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  runApp(ProviderScope(
    overrides: [
      interactionStoreProvider.overrideWithValue(InteractionStore(prefs)),
    ],
    child: const PtMobileApp(),
  ));
}

class PtMobileApp extends StatelessWidget {
  const PtMobileApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'PT Mobile',
        theme: ThemeData(useMaterial3: true),
        home: const HomeShell(),
      );
}
```

- [ ] **Step 8: Run full suite + analyze**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test && flutter analyze`
Expected: all tests PASS, `No issues found!`.

- [ ] **Step 9: Commit + push**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add -A && git commit -m "feat: Recommendations screen with scoring, swipe feedback and tab" && git push origin main
```

---

## Self-Review 메모

- **스펙 §5.3/§7 커버리지:** 오늘의 추천 상위 N(스와이프, Task 2·5) / 잊힌 프로젝트(Task 2·5) / 투명 가중치 스코어링 공식 priority+proximity+staleness+readiness−issues(Task 2) / 상호작용 누적 가중치 조정(Task 1·3·4) / 탭 추가(Task 5) 모두 태스크 존재. "작업 시작" 버튼(경로 복사)은 상세 화면(Projects 슬라이스)의 SelectableText로 이미 충족 — 추천 카드 탭은 상호작용 기록 용도로 사용.
- **타입 일관성:** `RecommendationWeights{priority,proximity,staleness,readiness,issues}+defaults+adjusted`, `RecommendationEngine.score/recommend/forgotten`, `ScoredProject{project,score}`, `InteractionStore{taps,dismissals,recordTap,recordDismissal}`, providers(`interactionStoreProvider`,`weightsProvider`,`recommendationsProvider:List<ScoredProject>`,`forgottenProvider:List<Project>`) 전 태스크 일관.
- **Task 4 코드 주의:** Step 3은 최종형(두 번째 코드블록, `List<Project>` + `import '../models/project.dart'`)을 사용한다. 첫 블록의 `List<dynamic>`는 쓰지 않는다.
- **shared_preferences 전제:** pubspec에 이미 존재(Foundation에서 추가됨). 없으면 `flutter pub add shared_preferences` 먼저.
- **연기:** Trends/Notifications는 후속. 추천의 진짜 ML은 비목표(스펙 §1).
```
