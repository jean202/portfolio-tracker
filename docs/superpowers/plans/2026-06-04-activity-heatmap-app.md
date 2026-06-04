# 활동 히트맵 — pt-mobile 렌더링 Implementation Plan (2/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pt-mobile이 `Activity.recentCommitDays`를 파싱해 전 프로젝트를 일자별로 합산하고, Trends 탭에 GitHub식 13주 활동 히트맵을 렌더링한다(셋째 라인차트였던 "활성 추세"를 대체). 히트맵은 스냅샷 1개부터 표시.

**Architecture:** 순수 `CommitHeatmap.fromProjects(projects, now, weeks)`가 합산 → 일요일 시작 13×7 그리드 생성(핵심 테스트). `ActivityHeatmap` 위젯이 5단계 색으로 렌더. `TrendsScreen`은 최신 스냅샷으로 히트맵을, 스냅샷 2개 이상일 때 추가로 라인차트를 보인다.

**Tech Stack:** Flutter, Riverpod, flutter_test.

> **레포:** `/Users/jean325/portfolio/projects/pt-mobile/` (이하 경로 상대). GitHub `jean202/pt-mobile`, main.
>
> **환경:** Flutter/Dart는 PATH에 없다. 모든 flutter/dart 명령 앞에 같은 줄에서 `export PATH="$PATH:/Users/jean325/development/flutter/bin" && `. 종료코드는 `; echo exit=$?`로 확인(파이프가 가리지 않도록).
>
> **선행:** PT 플랜(1/2) 완료 후 `scan-result.json`이 `recentCommitDays`를 포함해야 실데이터가 들어온다. 단, 이 앱 플랜은 모델 파싱부터 테스트로 독립 진행 가능(픽스처/리터럴 사용).

## 기존 코드 (참고)

- `lib/models/project.dart` — `Activity{lastCommitDate?,lastCommitMessage?,commitsInLastWeek,isActive,daysSinceLastCommit}` + `Activity.fromJson`. `Project{...,activity?,...}`.
- `lib/trends/trend_providers.dart` — `snapshotHistoryProvider:FutureProvider<List<ScanResult>>`(newest-first), `trendSeriesProvider`.
- `lib/trends/trends_screen.dart` — `TrendsScreen`(ConsumerWidget): `snapshotHistoryProvider.when(...)`; `snaps.isEmpty`→빈상태, `!series.hasEnoughForTrend`→"누적" 안내, else 델타 2개 + `TrendLineChart` 3개(진행률/준비도/**활성** — 마지막을 교체).
- `lib/trends/trend_line_chart.dart` — `TrendLineChart{title, values}`.
- 테스트 패턴: `databaseProvider`(in-memory override) + `UncontrolledProviderScope`. `test/trends/trends_screen_test.dart` 존재(빈/제한/2-snapshot 케이스).

---

## File Structure

| 파일 | 책임 |
|------|------|
| `lib/models/project.dart` | (수정) `Activity.recentCommitDays: Map<String,int>` 추가·파싱 |
| `lib/trends/commit_heatmap.dart` | (신규) `HeatmapCell`, `CommitHeatmap.fromProjects` 순수 |
| `lib/trends/activity_heatmap.dart` | (신규) 히트맵 그리드 위젯 |
| `lib/trends/trends_screen.dart` | (수정) 활성 라인 → 히트맵, 게이팅 재구성 |
| `test/models/project_test.dart` | (수정) recentCommitDays 파싱 테스트 |
| `test/trends/commit_heatmap_test.dart` | 순수 집계 테스트 |
| `test/trends/activity_heatmap_test.dart` | 위젯 스모크 |
| `test/trends/trends_screen_test.dart` | (수정) 히트맵 통합 |

---

## Task 1: Activity.recentCommitDays 파싱

**Files:**
- Modify: `lib/models/project.dart`
- Test: `test/models/project_test.dart`

- [ ] **Step 1: Write the failing test**

Append inside `main()` of `test/models/project_test.dart`:
```dart
  test('activity parses recentCommitDays tolerantly', () {
    final p = Project.fromJson({
      'id': 'a',
      'name': 'a',
      'activity': {
        'recentCommitDays': {
          '2026-06-01': 3,
          '2026-06-02': 1,
          'bad': 'x', // non-numeric value → skipped
        }
      },
    });
    expect(p.activity?.recentCommitDays['2026-06-01'], 3);
    expect(p.activity?.recentCommitDays['2026-06-02'], 1);
    expect(p.activity?.recentCommitDays.containsKey('bad'), isFalse);
  });

  test('activity recentCommitDays defaults to empty when absent', () {
    final p = Project.fromJson({'id': 'a', 'name': 'a', 'activity': {'isActive': true}});
    expect(p.activity?.recentCommitDays, isEmpty);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/models/project_test.dart`
Expected: FAIL — `recentCommitDays` getter doesn't exist.

- [ ] **Step 3: Add the field + tolerant parse**

In `lib/models/project.dart`, the `Activity` class. Add the field, constructor param, and parse. Replace the `Activity` class with:
```dart
class Activity {
  final DateTime? lastCommitDate;
  final String? lastCommitMessage;
  final int commitsInLastWeek;
  final bool isActive;
  final int daysSinceLastCommit;
  final Map<String, int> recentCommitDays;
  Activity({
    this.lastCommitDate,
    this.lastCommitMessage,
    this.commitsInLastWeek = 0,
    this.isActive = false,
    this.daysSinceLastCommit = 0,
    this.recentCommitDays = const {},
  });
  factory Activity.fromJson(Map<String, dynamic> j) => Activity(
        lastCommitDate: DateTime.tryParse(j['lastCommitDate']?.toString() ?? ''),
        lastCommitMessage: j['lastCommitMessage'] as String?,
        commitsInLastWeek: (j['commitsInLastWeek'] as num?)?.toInt() ?? 0,
        isActive: j['isActive'] as bool? ?? false,
        daysSinceLastCommit: (j['daysSinceLastCommit'] as num?)?.toInt() ?? 0,
        recentCommitDays: _parseCommitDays(j['recentCommitDays']),
      );
}

Map<String, int> _parseCommitDays(Object? v) {
  if (v is! Map) return const {};
  final out = <String, int>{};
  v.forEach((key, value) {
    if (key is String && value is num) out[key] = value.toInt();
  });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/models/project_test.dart`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/models/project.dart test/models/project_test.dart && git commit -m "feat: parse Activity.recentCommitDays"
```

---

## Task 2: CommitHeatmap (순수 집계)

**Files:**
- Create: `lib/trends/commit_heatmap.dart`
- Test: `test/trends/commit_heatmap_test.dart`

- [ ] **Step 1: Write the failing test**

`test/trends/commit_heatmap_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/models/project.dart';
import 'package:pt_mobile/trends/commit_heatmap.dart';

Project withDays(String id, Map<String, int> days) =>
    Project(id: id, name: id, activity: Activity(recentCommitDays: days));

void main() {
  // Fixed "now": 2026-06-04 is a Thursday.
  final now = DateTime(2026, 6, 4, 12);

  test('grid is weeks*7 cells, Sunday-first, last column holds today', () {
    final h = CommitHeatmap.fromProjects(const [], now: now, weeks: 13);
    expect(h.weeks.length, 13);
    expect(h.weeks.every((c) => c.length == 7), isTrue);
    // first cell of each column is a Sunday (weekday 7)
    expect(h.weeks.first.first.date.weekday, DateTime.sunday);
    // today (2026-06-04) is in the last column
    final lastCol = h.weeks.last;
    expect(lastCol.any((c) => c.date.year == 2026 && c.date.month == 6 && c.date.day == 4), isTrue);
  });

  test('sums counts across projects on the same day', () {
    final h = CommitHeatmap.fromProjects(
      [withDays('a', {'2026-06-02': 2}), withDays('b', {'2026-06-02': 3})],
      now: now,
    );
    final cell = h.weeks.expand((c) => c).firstWhere(
        (c) => c.date.year == 2026 && c.date.month == 6 && c.date.day == 2);
    expect(cell.count, 5);
    expect(h.maxCount, 5);
    expect(h.total, 5);
  });

  test('days with no commits are zero', () {
    final h = CommitHeatmap.fromProjects(
      [withDays('a', {'2026-06-02': 1})],
      now: now,
    );
    final empties = h.weeks.expand((c) => c).where((c) => c.count == 0);
    expect(empties.isNotEmpty, isTrue);
    expect(h.total, 1);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/trends/commit_heatmap_test.dart`
Expected: FAIL — `commit_heatmap.dart` 없음.

- [ ] **Step 3: Implement `lib/trends/commit_heatmap.dart`**

```dart
import '../models/project.dart';

class HeatmapCell {
  final DateTime date;
  final int count;
  const HeatmapCell(this.date, this.count);
}

/// Portfolio-wide commit heatmap: per-day counts summed across all projects,
/// arranged into [weeks] Sunday-first columns ending at the week of [now].
class CommitHeatmap {
  final List<List<HeatmapCell>> weeks; // columns; each inner = 7 cells (Sun..Sat)
  final int maxCount;
  final int total;
  const CommitHeatmap(this.weeks, this.maxCount, this.total);

  factory CommitHeatmap.fromProjects(
    List<Project> projects, {
    required DateTime now,
    int weeks = 13,
  }) {
    final agg = <String, int>{};
    for (final p in projects) {
      p.activity?.recentCommitDays.forEach((k, v) {
        if (v > 0) agg[k] = (agg[k] ?? 0) + v;
      });
    }

    final today = DateTime(now.year, now.month, now.day);
    final sundayIdx = today.weekday % 7; // Sun(7)→0, Mon(1)→1, ... Sat(6)→6
    final currentSunday = today.subtract(Duration(days: sundayIdx));
    final firstSunday = currentSunday.subtract(Duration(days: 7 * (weeks - 1)));

    final columns = <List<HeatmapCell>>[];
    var maxCount = 0;
    var total = 0;
    for (var c = 0; c < weeks; c++) {
      final col = <HeatmapCell>[];
      for (var r = 0; r < 7; r++) {
        final date = firstSunday.add(Duration(days: c * 7 + r));
        final count = agg[_key(date)] ?? 0;
        if (count > maxCount) maxCount = count;
        total += count;
        col.add(HeatmapCell(date, count));
      }
      columns.add(col);
    }
    return CommitHeatmap(columns, maxCount, total);
  }

  static String _key(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/trends/commit_heatmap_test.dart`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/trends/commit_heatmap.dart test/trends/commit_heatmap_test.dart && git commit -m "feat: CommitHeatmap portfolio-wide aggregation"
```

---

## Task 3: ActivityHeatmap 위젯

**Files:**
- Create: `lib/trends/activity_heatmap.dart`
- Test: `test/trends/activity_heatmap_test.dart`

- [ ] **Step 1: Write the failing test**

`test/trends/activity_heatmap_test.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/models/project.dart';
import 'package:pt_mobile/trends/activity_heatmap.dart';
import 'package:pt_mobile/trends/commit_heatmap.dart';

void main() {
  testWidgets('renders title + total and builds without error', (tester) async {
    final data = CommitHeatmap.fromProjects(
      [Project(id: 'a', name: 'a', activity: Activity(recentCommitDays: const {'2026-06-02': 4}))],
      now: DateTime(2026, 6, 4),
    );
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ActivityHeatmap(data: data))));
    expect(find.text('활동 히트맵'), findsOneWidget);
    expect(find.textContaining('commits'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/trends/activity_heatmap_test.dart`
Expected: FAIL — `activity_heatmap.dart` 없음.

- [ ] **Step 3: Implement `lib/trends/activity_heatmap.dart`**

```dart
import 'package:flutter/material.dart';
import 'commit_heatmap.dart';

class ActivityHeatmap extends StatelessWidget {
  final CommitHeatmap data;
  const ActivityHeatmap({super.key, required this.data});

  // 5 intensity levels by commit count: 0, 1-2, 3-4, 5-7, 8+
  static int _level(int count) {
    if (count == 0) return 0;
    if (count <= 2) return 1;
    if (count <= 4) return 2;
    if (count <= 7) return 3;
    return 4;
  }

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.primary;
    final colors = <Color>[
      Theme.of(context).colorScheme.surfaceContainerHighest,
      base.withValues(alpha: 0.30),
      base.withValues(alpha: 0.50),
      base.withValues(alpha: 0.75),
      base,
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('활동 히트맵', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 2),
        Text('최근 13주 · ${data.total} commits',
            style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 8),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final column in data.weeks)
                Column(
                  children: [
                    for (final cell in column)
                      Container(
                        width: 14,
                        height: 14,
                        margin: const EdgeInsets.all(1.5),
                        decoration: BoxDecoration(
                          color: colors[_level(cell.count)],
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                  ],
                ),
            ],
          ),
        ),
      ],
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/trends/activity_heatmap_test.dart`
Expected: PASS (1 test).

> 참고: `Color.withValues`는 최신 Flutter(API). 만약 사용 중 SDK에서 미지원이면 `base.withOpacity(0.30)` 등으로 대체(동작 동일). 구현 중 `flutter analyze`가 deprecated 경고를 주면 가용 API로 맞춘다.

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/trends/activity_heatmap.dart test/trends/activity_heatmap_test.dart && git commit -m "feat: ActivityHeatmap grid widget"
```

---

## Task 4: TrendsScreen 통합 (활성 라인 → 히트맵, 게이팅 재구성)

**Files:**
- Modify: `lib/trends/trends_screen.dart`
- Test: `test/trends/trends_screen_test.dart`

- [ ] **Step 1: Update the screen test for the new behavior**

In `test/trends/trends_screen_test.dart`, add imports:
```dart
import 'package:pt_mobile/trends/activity_heatmap.dart';
```
Replace the `'limited state with a single snapshot'` test body and add a heatmap assertion to the two-snapshot test. Specifically:

Change the single-snapshot test to:
```dart
  testWidgets('single snapshot shows the heatmap but not the trend lines', (tester) async {
    final c = memContainer();
    addTearDown(c.dispose);
    await c.read(repositoryProvider).saveSnapshot('{"projects":[{"id":"a","name":"a","progress":{"percentage":50},"readiness":60,"activity":{"recentCommitDays":{"2026-06-02":2}}}]}');
    await tester.pumpWidget(host(c));
    await tester.pumpAndSettle();
    expect(find.byType(ActivityHeatmap), findsOneWidget);
    expect(find.text('진행률 추세'), findsNothing); // line charts need >=2 snapshots
    expect(find.textContaining('누적'), findsOneWidget); // line-chart hint
  });
```

And in `'shows trend charts with two snapshots'`, after the existing expects add:
```dart
    expect(find.byType(ActivityHeatmap), findsOneWidget);
```
(keep the existing `'empty state with no snapshot'` test unchanged.)

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/trends/trends_screen_test.dart`
Expected: FAIL — `ActivityHeatmap` not used by the screen yet; '누적' now expected alongside heatmap.

- [ ] **Step 3: Rewrite the `data:` branch of `trends_screen.dart`**

Replace the entire `data: (snaps) { ... }` callback body in `lib/trends/trends_screen.dart` with:
```dart
        data: (snaps) {
          if (snaps.isEmpty) {
            return const Center(child: Text('스캔 결과를 가져오세요 (Dashboard 탭)'));
          }
          final heatmap =
              CommitHeatmap.fromProjects(snaps.first.projects, now: DateTime.now());
          final series = ref.watch(trendSeriesProvider);
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              ActivityHeatmap(data: heatmap),
              const SizedBox(height: 24),
              if (series.hasEnoughForTrend) ...[
                _DeltaRow(label: '진행률 변화', delta: series.progressDelta),
                _DeltaRow(label: '준비도 변화', delta: series.readinessDelta),
                const SizedBox(height: 16),
                TrendLineChart(
                    title: '진행률 추세',
                    values: [for (final p in series.points) p.avgProgress]),
                const SizedBox(height: 24),
                TrendLineChart(
                    title: '준비도 추세',
                    values: [for (final p in series.points) p.avgReadiness]),
              ] else
                const Text('추세 라인은 import를 누적하면 보입니다 (스냅샷 2개 이상)'),
            ],
          );
        },
```

Add the imports at the top of the file (keep existing imports):
```dart
import 'activity_heatmap.dart';
import 'commit_heatmap.dart';
```
Remove the now-unused active-series line chart code (the third `TrendLineChart` with `activeCount` values) — it no longer appears in the new body above. Keep the `_DeltaRow` class.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/trends/trends_screen_test.dart`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite + analyze**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test ; echo test_exit=$? ; flutter analyze ; echo analyze_exit=$?`
Expected: all tests PASS, `No issues found!`. (If `flutter analyze` flags `withValues` as unavailable/deprecated, switch to `withOpacity` in `activity_heatmap.dart` and re-run.)

- [ ] **Step 6: Commit + push**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add -A && git commit -m "feat: activity heatmap on Trends, replacing the active-count line" && git push origin main
```

---

## Self-Review 메모

- **스펙 §3(앱)/§5/§6 커버리지:** `recentCommitDays` 파싱(Task 1) / `CommitHeatmap.fromProjects` 합산·그리드(Task 2) / 위젯(Task 3) / Trends 통합·게이팅(Task 4) / 빈·1개·2개 상태(Task 4 테스트) 모두 태스크 존재.
- **타입 일관성:** `Activity.recentCommitDays: Map<String,int>`(Task 1) → `CommitHeatmap.fromProjects(List<Project>, {now, weeks})`(Task 2) → `ActivityHeatmap{data: CommitHeatmap}`(Task 3) → `TrendsScreen`(Task 4). 키 포맷 `YYYY-MM-DD`는 PT `localDayKey`와 동일(zero-pad).
- **게이팅 개선:** 히트맵은 스냅샷 1개부터(최신 1장으로 충분), 라인차트는 2개 이상. 빈 상태(0개)는 유지.
- **차트 정직성:** 히트맵/라인 위젯은 스모크(제목·예외)만; 합산·그리드 로직은 `CommitHeatmap` 순수 테스트로 강하게 검증.
- **SDK 주의:** `Color.withValues`(신규) 미지원 시 `withOpacity`로 대체(plan에 명시).
- **선행 의존:** 실데이터는 PT 플랜(1/2) 완료 후. 앱 플랜은 리터럴/픽스처로 독립 테스트 가능.
```
