# 모바일 앱 Trends 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 누적된 스냅샷 히스토리(Drift)에서 진행률·준비도·활성 프로젝트 수의 시계열을 계산해 라인 차트로 보여주고, 첫↔마지막 변화량을 요약한다. 스냅샷이 1개뿐이면 제한 상태로 안내한다.

**Architecture:** 순수 클래스 `TrendSeries.fromHistory(List<ScanResult>)`가 히스토리(newest-first)를 시간순으로 뒤집어 스냅샷별 집계점(`TrendPoint`)을 만들고 델타를 노출한다(테스트 집중). `snapshotHistoryProvider`(FutureProvider)는 `latestSnapshotProvider`를 watch해 import 시 갱신된다. 화면은 fl_chart LineChart로 렌더링. Trends 탭을 HomeShell에 추가.

**Tech Stack:** Flutter, Riverpod, Drift, fl_chart, flutter_test.

> **앱 위치:** `/Users/jean325/portfolio/projects/pt-mobile/`. 모든 경로는 이 디렉토리 기준.
>
> **환경:** Flutter/Dart는 PATH에 없다. 모든 명령 앞에 같은 줄에서 `export PATH="$PATH:/Users/jean325/development/flutter/bin" && ` 를 붙인다. Dart 3.11.5. 명령 실행 시 종료코드를 확인할 것(파이프가 exit code를 가리지 않도록).

## 기존 코드 (이미 존재)

- `lib/models/scan_result.dart` — `ScanResult{projects:List<Project>, scannedAt:DateTime?, summary}`.
- `lib/models/project.dart` — `Project{readiness, progress?(percentage), activity?(isActive), ...}`.
- `lib/data/snapshot_repository.dart` — `SnapshotRepository.history():Future<List<ScanResult>>`(newest-first), `latest()`, `saveSnapshot()`.
- `lib/providers.dart` — `latestSnapshotProvider:FutureProvider<ScanResult?>`, `repositoryProvider`, `databaseProvider`.
- `lib/data/database_connection.dart` — `openConnection({inMemory})`.
- `lib/shell/home_shell.dart` — `_screens=[DashboardScreen, ProjectsScreen, RecommendationsScreen]`, NavigationBar 3 destinations. 활성 화면만 마운트.
- fl_chart 이미 의존성에 있음(Dashboard에서 추가).
- 테스트 패턴: `databaseProvider`(in-memory override) + `interactionStoreProvider` override(HomeShell 테스트엔 필요) + `UncontrolledProviderScope`.

---

## File Structure

| 파일 | 책임 |
|------|------|
| `lib/trends/trend_series.dart` | (신규) 히스토리→시계열 집계 순수 로직 |
| `lib/trends/trend_providers.dart` | (신규) `snapshotHistoryProvider`, `trendSeriesProvider` |
| `lib/trends/trend_line_chart.dart` | (신규) 라벨 붙은 라인 차트 위젯 |
| `lib/trends/trends_screen.dart` | (신규) 시계열 차트 + 변화 요약 + 빈/제한 상태 |
| `lib/shell/home_shell.dart` | (수정) Trends 탭 추가 |
| `test/trends/trend_series_test.dart` | 순수 로직 테스트 |
| `test/trends/trend_providers_test.dart` | provider 테스트 |
| `test/trends/trends_screen_test.dart` | 화면 테스트 |
| `test/shell/home_shell_test.dart` | (수정) 4탭 전환 |

---

## Task 1: TrendSeries (시계열 집계 순수 로직)

**Files:**
- Create: `lib/trends/trend_series.dart`
- Test: `test/trends/trend_series_test.dart`

- [ ] **Step 1: Write the failing test**

`test/trends/trend_series_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/models/project.dart';
import 'package:pt_mobile/models/scan_result.dart';
import 'package:pt_mobile/trends/trend_series.dart';

ScanResult snap({required int progress, required int readiness, bool active = false, DateTime? at}) =>
    ScanResult(
      scannedAt: at,
      projects: [
        Project(
          id: 'p',
          name: 'p',
          readiness: readiness,
          progress: Progress(percentage: progress),
          activity: Activity(isActive: active),
        ),
      ],
    );

void main() {
  test('empty history yields no points and not enough for a trend', () {
    final s = TrendSeries.fromHistory(const []);
    expect(s.points, isEmpty);
    expect(s.hasEnoughForTrend, isFalse);
  });

  test('single snapshot yields one point, not enough for a trend', () {
    final s = TrendSeries.fromHistory([snap(progress: 50, readiness: 60)]);
    expect(s.points.length, 1);
    expect(s.hasEnoughForTrend, isFalse);
  });

  test('history (newest-first) is reversed to chronological points', () {
    // input newest-first: newer=progress80, older=progress20
    final s = TrendSeries.fromHistory([
      snap(progress: 80, readiness: 70),
      snap(progress: 20, readiness: 30),
    ]);
    expect(s.points.first.avgProgress, 20); // oldest first
    expect(s.points.last.avgProgress, 80);
    expect(s.hasEnoughForTrend, isTrue);
  });

  test('per-snapshot aggregates average across projects', () {
    final multi = ScanResult(projects: [
      Project(id: 'a', name: 'a', readiness: 40, progress: Progress(percentage: 10), activity: Activity(isActive: true)),
      Project(id: 'b', name: 'b', readiness: 80, progress: Progress(percentage: 50), activity: Activity(isActive: false)),
    ]);
    final s = TrendSeries.fromHistory([multi]);
    final p = s.points.single;
    expect(p.avgProgress, 30); // (10+50)/2
    expect(p.avgReadiness, 60); // (40+80)/2
    expect(p.activeCount, 1);
    expect(p.total, 2);
  });

  test('deltas compare last to first', () {
    final s = TrendSeries.fromHistory([
      snap(progress: 80, readiness: 70), // newest
      snap(progress: 20, readiness: 40), // oldest
    ]);
    expect(s.progressDelta, 60); // 80 - 20
    expect(s.readinessDelta, 30); // 70 - 40
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/trends/trend_series_test.dart`
Expected: FAIL — `trend_series.dart` 없음.

- [ ] **Step 3: Implement `lib/trends/trend_series.dart`**

```dart
import '../models/scan_result.dart';

/// One aggregated point in time (one snapshot).
class TrendPoint {
  final DateTime? at;
  final double avgProgress;
  final double avgReadiness;
  final int activeCount;
  final int total;
  const TrendPoint({
    required this.at,
    required this.avgProgress,
    required this.avgReadiness,
    required this.activeCount,
    required this.total,
  });

  factory TrendPoint.fromScan(ScanResult scan) {
    final projects = scan.projects;
    final n = projects.length;
    if (n == 0) {
      return TrendPoint(at: scan.scannedAt, avgProgress: 0, avgReadiness: 0, activeCount: 0, total: 0);
    }
    var progressSum = 0;
    var readinessSum = 0;
    var active = 0;
    for (final p in projects) {
      progressSum += p.progress?.percentage ?? 0;
      readinessSum += p.readiness;
      if (p.activity?.isActive ?? false) active++;
    }
    return TrendPoint(
      at: scan.scannedAt,
      avgProgress: progressSum / n,
      avgReadiness: readinessSum / n,
      activeCount: active,
      total: n,
    );
  }
}

/// Chronological trend across snapshots, derived from repository history.
class TrendSeries {
  final List<TrendPoint> points; // oldest → newest
  const TrendSeries(this.points);

  /// [historyNewestFirst] is the repository order; this reverses it so points
  /// run left-to-right oldest → newest.
  factory TrendSeries.fromHistory(List<ScanResult> historyNewestFirst) {
    final chronological = historyNewestFirst.reversed
        .map(TrendPoint.fromScan)
        .toList(growable: false);
    return TrendSeries(chronological);
  }

  bool get hasEnoughForTrend => points.length >= 2;

  double get progressDelta =>
      points.isEmpty ? 0 : points.last.avgProgress - points.first.avgProgress;
  double get readinessDelta =>
      points.isEmpty ? 0 : points.last.avgReadiness - points.first.avgReadiness;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/trends/trend_series_test.dart`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/trends/trend_series.dart test/trends/trend_series_test.dart && git commit -m "feat: TrendSeries history aggregation"
```

---

## Task 2: Trend providers

**Files:**
- Create: `lib/trends/trend_providers.dart`
- Test: `test/trends/trend_providers_test.dart`

- [ ] **Step 1: Write the failing test**

`test/trends/trend_providers_test.dart`:
```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/data/database_connection.dart';
import 'package:pt_mobile/data/snapshot_database.dart';
import 'package:pt_mobile/providers.dart';
import 'package:pt_mobile/trends/trend_providers.dart';

ProviderContainer memContainer() => ProviderContainer(overrides: [
      databaseProvider.overrideWith((ref) {
        final db = SnapshotDatabase(openConnection(inMemory: true));
        ref.onDispose(db.close);
        return db;
      }),
    ]);

void main() {
  test('trendSeriesProvider builds chronological points from saved snapshots', () async {
    final c = memContainer();
    addTearDown(c.dispose);
    await c.read(repositoryProvider).saveSnapshot('{"projects":[{"id":"a","name":"a","progress":{"percentage":20},"readiness":30}]}');
    await c.read(repositoryProvider).saveSnapshot('{"projects":[{"id":"a","name":"a","progress":{"percentage":80},"readiness":70}]}');

    // Resolve the history future first.
    await c.read(snapshotHistoryProvider.future);
    final series = c.read(trendSeriesProvider);
    expect(series.points.length, 2);
    expect(series.points.first.avgProgress, 20); // oldest first
    expect(series.points.last.avgProgress, 80);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/trends/trend_providers_test.dart`
Expected: FAIL — `trend_providers.dart` 없음.

- [ ] **Step 3: Implement `lib/trends/trend_providers.dart`**

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/scan_result.dart';
import '../providers.dart';
import 'trend_series.dart';

/// Full snapshot history (newest-first). Re-reads whenever a new snapshot is
/// imported (latestSnapshotProvider is invalidated on import).
final snapshotHistoryProvider = FutureProvider<List<ScanResult>>((ref) async {
  ref.watch(latestSnapshotProvider);
  return ref.watch(repositoryProvider).history();
});

final trendSeriesProvider = Provider<TrendSeries>((ref) {
  final history = ref.watch(snapshotHistoryProvider).valueOrNull ?? const [];
  return TrendSeries.fromHistory(history);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/trends/trend_providers_test.dart`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/trends/trend_providers.dart test/trends/trend_providers_test.dart && git commit -m "feat: trend providers (history + series)"
```

---

## Task 3: TrendLineChart 위젯

**Files:**
- Create: `lib/trends/trend_line_chart.dart`
- Test: `test/trends/trend_line_chart_test.dart`

- [ ] **Step 1: Write the failing test**

`test/trends/trend_line_chart_test.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/trends/trend_line_chart.dart';

void main() {
  testWidgets('renders title and builds without error', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: TrendLineChart(title: '진행률 추세', values: [10, 40, 80]),
      ),
    ));
    expect(find.text('진행률 추세'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('handles a single value without error', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(body: TrendLineChart(title: 'x', values: [42])),
    ));
    expect(tester.takeException(), isNull);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/trends/trend_line_chart_test.dart`
Expected: FAIL — `trend_line_chart.dart` 없음.

- [ ] **Step 3: Implement `lib/trends/trend_line_chart.dart`**

```dart
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

class TrendLineChart extends StatelessWidget {
  final String title;
  final List<double> values; // chronological
  const TrendLineChart({super.key, required this.title, required this.values});

  @override
  Widget build(BuildContext context) {
    final spots = [
      for (var i = 0; i < values.length; i++) FlSpot(i.toDouble(), values[i]),
    ];
    final maxY = values.isEmpty
        ? 1.0
        : (values.reduce((a, b) => a > b ? a : b)).clamp(1.0, double.infinity);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        SizedBox(
          height: 180,
          child: LineChart(LineChartData(
            minY: 0,
            maxY: maxY,
            lineBarsData: [
              LineChartBarData(
                spots: spots,
                isCurved: false,
                dotData: const FlDotData(show: true),
              ),
            ],
            titlesData: const FlTitlesData(
              leftTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 28)),
              topTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
              rightTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
              bottomTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
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

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/trends/trend_line_chart_test.dart`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/trends/trend_line_chart.dart test/trends/trend_line_chart_test.dart && git commit -m "feat: TrendLineChart widget"
```

---

## Task 4: TrendsScreen + 탭 추가

**Files:**
- Create: `lib/trends/trends_screen.dart`
- Modify: `lib/shell/home_shell.dart`
- Modify: `test/shell/home_shell_test.dart`
- Test: `test/trends/trends_screen_test.dart`

- [ ] **Step 1: Write the failing screen test**

`test/trends/trends_screen_test.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/data/database_connection.dart';
import 'package:pt_mobile/data/snapshot_database.dart';
import 'package:pt_mobile/providers.dart';
import 'package:pt_mobile/trends/trends_screen.dart';

ProviderContainer memContainer() => ProviderContainer(overrides: [
      databaseProvider.overrideWith((ref) {
        final db = SnapshotDatabase(openConnection(inMemory: true));
        ref.onDispose(db.close);
        return db;
      }),
    ]);

Widget host(ProviderContainer c) => UncontrolledProviderScope(
      container: c,
      child: const MaterialApp(home: TrendsScreen()),
    );

void main() {
  testWidgets('empty state with no snapshot', (tester) async {
    final c = memContainer();
    addTearDown(c.dispose);
    await tester.pumpWidget(host(c));
    await tester.pumpAndSettle();
    expect(find.textContaining('가져오'), findsOneWidget);
  });

  testWidgets('limited state with a single snapshot', (tester) async {
    final c = memContainer();
    addTearDown(c.dispose);
    await c.read(repositoryProvider).saveSnapshot('{"projects":[{"id":"a","name":"a","progress":{"percentage":50},"readiness":60}]}');
    await tester.pumpWidget(host(c));
    await tester.pumpAndSettle();
    expect(find.textContaining('누적'), findsOneWidget); // "import를 누적하세요"
  });

  testWidgets('shows trend charts with two snapshots', (tester) async {
    final c = memContainer();
    addTearDown(c.dispose);
    await c.read(repositoryProvider).saveSnapshot('{"projects":[{"id":"a","name":"a","progress":{"percentage":20},"readiness":30}]}');
    await c.read(repositoryProvider).saveSnapshot('{"projects":[{"id":"a","name":"a","progress":{"percentage":80},"readiness":70}]}');
    await tester.pumpWidget(host(c));
    await tester.pumpAndSettle();
    expect(find.text('진행률 추세'), findsOneWidget);
    expect(find.text('준비도 추세'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/trends/trends_screen_test.dart`
Expected: FAIL — `trends_screen.dart` 없음.

- [ ] **Step 3: Implement `lib/trends/trends_screen.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'trend_line_chart.dart';
import 'trend_providers.dart';

class TrendsScreen extends ConsumerWidget {
  const TrendsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(snapshotHistoryProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Trends')),
      body: history.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('오류: $e')),
        data: (snaps) {
          if (snaps.isEmpty) {
            return const Center(child: Text('스캔 결과를 가져오세요 (Dashboard 탭)'));
          }
          final series = ref.watch(trendSeriesProvider);
          if (!series.hasEnoughForTrend) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text('추세를 보려면 import를 누적하세요 (스냅샷 2개 이상 필요)',
                    textAlign: TextAlign.center),
              ),
            );
          }
          final progress = [for (final p in series.points) p.avgProgress];
          final readiness = [for (final p in series.points) p.avgReadiness];
          final active = [for (final p in series.points) p.activeCount.toDouble()];
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _DeltaRow(label: '진행률 변화', delta: series.progressDelta),
              _DeltaRow(label: '준비도 변화', delta: series.readinessDelta),
              const SizedBox(height: 16),
              TrendLineChart(title: '진행률 추세', values: progress),
              const SizedBox(height: 24),
              TrendLineChart(title: '준비도 추세', values: readiness),
              const SizedBox(height: 24),
              TrendLineChart(title: '활성 프로젝트 추세', values: active),
            ],
          );
        },
      ),
    );
  }
}

class _DeltaRow extends StatelessWidget {
  final String label;
  final double delta;
  const _DeltaRow({required this.label, required this.delta});

  @override
  Widget build(BuildContext context) {
    final sign = delta > 0 ? '+' : '';
    final color = delta > 0
        ? Colors.green
        : (delta < 0 ? Colors.red : Theme.of(context).disabledColor);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label),
          Text('$sign${delta.toStringAsFixed(1)}',
              style: TextStyle(color: color, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/trends/trends_screen_test.dart`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the Trends tab to `home_shell.dart`**

In `lib/shell/home_shell.dart`, add the import and extend `_screens` + `destinations`:
```dart
import '../trends/trends_screen.dart';
```
Change `_screens`:
```dart
  static const _screens = [
    DashboardScreen(),
    ProjectsScreen(),
    RecommendationsScreen(),
    TrendsScreen(),
  ];
```
Add a destination after the Recommend one:
```dart
          NavigationDestination(icon: Icon(Icons.show_chart), label: 'Trends'),
```

- [ ] **Step 6: Add a 4th-tab test to `home_shell_test.dart`**

Append inside `main()` of `test/shell/home_shell_test.dart` (the existing imports already include interactionStore/recommendation/shared_preferences):
```dart
  testWidgets('switches to Trends tab', (tester) async {
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
    await tester.tap(find.byIcon(Icons.show_chart));
    await tester.pumpAndSettle();
    expect(find.byType(TrendsScreen), findsOneWidget);
  });
```
And add the import at the top:
```dart
import 'package:pt_mobile/trends/trends_screen.dart';
```

- [ ] **Step 7: Run full suite + analyze**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test && flutter analyze`
Expected: all tests PASS, `No issues found!`.

- [ ] **Step 8: Commit + push**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add -A && git commit -m "feat: Trends screen with time-series charts and deltas" && git push origin main
```

---

## Self-Review 메모

- **스펙 §5.4 커버리지:** 진행률 시계열(Task 1·3·4) / 준비도 변화(델타 + 준비도 추세 차트) / 활동성 — **활성 프로젝트 수 시계열로 재해석**(진짜 일자별 히트맵은 데이터(일별 커밋) 부재로 비현실적; YAGNI 일관). 빈/제한 상태(Task 4) 포함.
- **타입 일관성:** `TrendPoint{at,avgProgress,avgReadiness,activeCount,total}`, `TrendSeries{points, hasEnoughForTrend, progressDelta, readinessDelta}`, `TrendLineChart{title,values:List<double>}`, providers(`snapshotHistoryProvider:FutureProvider<List<ScanResult>>`, `trendSeriesProvider:Provider<TrendSeries>`) 전 태스크 일관. 기존 `SnapshotRepository.history`, `latestSnapshotProvider`, `openConnection` 재사용.
- **갱신 경로:** `snapshotHistoryProvider`가 `latestSnapshotProvider`를 watch → Dashboard import가 latest를 invalidate하면 history도 재계산.
- **차트 테스트 정직성:** 라인 차트는 제목 + 예외 없음만 검증; 수치 로직은 `TrendSeries`/provider 테스트로 강하게 검증.
- **연기:** Notifications가 마지막 슬라이스.
```
