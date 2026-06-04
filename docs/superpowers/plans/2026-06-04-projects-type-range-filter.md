# Projects type/range 필터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Projects 화면 필터에 프로젝트 타입(칩) + 준비도 구간(RangeSlider)을 추가한다.

**Architecture:** 순수 `ProjectQuery`에 `types`/`minReadiness`/`maxReadiness`를 더하고 `apply`/`copyWith` 확장(핵심 테스트). `ProjectsScreen`에 타입 칩 행과 준비도 RangeSlider를 인라인으로 추가.

**Tech Stack:** Flutter, Riverpod, flutter_test.

> **레포:** `/Users/jean325/portfolio/projects/pt-mobile/`. GitHub `jean202/pt-mobile`, main.
>
> **환경:** Flutter/Dart는 PATH에 없다. 모든 명령 앞에 같은 줄에서 `export PATH="$PATH:/Users/jean325/development/flutter/bin" && `. 종료코드는 `; echo exit=$?`로 확인.

## 기존 코드 (참고)

- `lib/projects/project_query.dart` — `ProjectQuery{search, priorities:Set<Priority>, activeOnly, sort}` + `copyWith` + `apply`. `apply`는 priority/active 체크 후 `if (q.isEmpty) return true;`로 search 단락.
- `lib/projects/projects_screen.dart` — body Column: 검색 Row, `_FilterChips(query)`(우선순위+활성 칩, 가로 스크롤), `Expanded(ListView)`. `query.apply(scan.projects)`로 results. `projectQueryProvider.notifier.update((q)=>q.copyWith(...))` 패턴.
- `lib/models/project.dart` — `Project{type:String, readiness:int, ...}`.

---

## File Structure

| 파일 | 책임 |
|------|------|
| `lib/projects/project_query.dart` | (수정) types/readiness 필드 + apply/copyWith |
| `lib/projects/projects_screen.dart` | (수정) 타입 칩 행 + 준비도 RangeSlider |
| `test/projects/project_query_test.dart` | (수정) type/range 테스트 추가 |
| `test/projects/projects_screen_test.dart` | (수정) 타입 칩·슬라이더 위젯 테스트 |

---

## Task 1: ProjectQuery — type + readiness 필터

**Files:**
- Modify: `lib/projects/project_query.dart`
- Test: `test/projects/project_query_test.dart`

- [ ] **Step 1: Write the failing tests**

Append inside `main()` of `test/projects/project_query_test.dart` (the `p({...})` helper there already supports `name`, `priority`, `readiness`, `progress`, `days`, `active`, `stack`; add `type` via a fresh literal where needed):
```dart
  test('type filter keeps only selected types', () {
    final list = [
      Project(id: 'n', name: 'n', type: 'node', readiness: 50),
      Project(id: 'd', name: 'd', type: 'dart', readiness: 50),
      Project(id: 'p', name: 'p', type: 'python', readiness: 50),
    ];
    final out = ProjectQuery(types: {'node', 'dart'}).apply(list);
    expect(out.map((e) => e.name).toSet(), {'n', 'd'});
  });

  test('empty types set passes all types', () {
    final list = [
      Project(id: 'n', name: 'n', type: 'node', readiness: 50),
      Project(id: 'd', name: 'd', type: 'dart', readiness: 50),
    ];
    expect(const ProjectQuery().apply(list).length, 2);
  });

  test('readiness range excludes outside, includes boundaries', () {
    final list = [
      Project(id: 'lo', name: 'lo', readiness: 20),
      Project(id: 'mid', name: 'mid', readiness: 50),
      Project(id: 'hi', name: 'hi', readiness: 80),
    ];
    final out = ProjectQuery(minReadiness: 50, maxReadiness: 80).apply(list);
    expect(out.map((e) => e.name).toSet(), {'mid', 'hi'});
  });

  test('type and readiness combine with existing filters', () {
    final list = [
      Project(id: 'a', name: 'a', type: 'node', readiness: 90, priority: Priority.critical),
      Project(id: 'b', name: 'b', type: 'node', readiness: 10, priority: Priority.critical),
      Project(id: 'c', name: 'c', type: 'dart', readiness: 90, priority: Priority.critical),
    ];
    final out = ProjectQuery(
      types: {'node'},
      minReadiness: 50,
      priorities: {Priority.critical},
    ).apply(list);
    expect(out.map((e) => e.name), ['a']);
  });

  test('copyWith replaces only the given new fields', () {
    const q = ProjectQuery(types: {'node'}, minReadiness: 10, maxReadiness: 90);
    final q2 = q.copyWith(minReadiness: 40);
    expect(q2.minReadiness, 40);
    expect(q2.maxReadiness, 90);
    expect(q2.types, {'node'});
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/projects/project_query_test.dart`
Expected: FAIL — `types`/`minReadiness`/`maxReadiness` named params don't exist.

- [ ] **Step 3: Extend `ProjectQuery`**

In `lib/projects/project_query.dart`, replace the fields, constructor, `copyWith`, and the filter section of `apply`:

Fields + constructor:
```dart
class ProjectQuery {
  final String search;
  final Set<Priority> priorities; // empty = all priorities
  final bool activeOnly;
  final Set<String> types; // empty = all types
  final int minReadiness;
  final int maxReadiness;
  final ProjectSort sort;

  const ProjectQuery({
    this.search = '',
    this.priorities = const {},
    this.activeOnly = false,
    this.types = const {},
    this.minReadiness = 0,
    this.maxReadiness = 100,
    this.sort = ProjectSort.readinessDesc,
  });
```

`copyWith`:
```dart
  ProjectQuery copyWith({
    String? search,
    Set<Priority>? priorities,
    bool? activeOnly,
    Set<String>? types,
    int? minReadiness,
    int? maxReadiness,
    ProjectSort? sort,
  }) =>
      ProjectQuery(
        search: search ?? this.search,
        priorities: priorities ?? this.priorities,
        activeOnly: activeOnly ?? this.activeOnly,
        types: types ?? this.types,
        minReadiness: minReadiness ?? this.minReadiness,
        maxReadiness: maxReadiness ?? this.maxReadiness,
        sort: sort ?? this.sort,
      );
```

`apply` — add type + readiness checks before the search short-circuit:
```dart
  List<Project> apply(List<Project> projects) {
    final q = search.trim().toLowerCase();
    final out = projects.where((p) {
      if (priorities.isNotEmpty && !priorities.contains(p.priority)) return false;
      if (activeOnly && !(p.activity?.isActive ?? false)) return false;
      if (types.isNotEmpty && !types.contains(p.type)) return false;
      if (p.readiness < minReadiness || p.readiness > maxReadiness) return false;
      if (q.isEmpty) return true;
      final hay = [p.name, p.path, ...?p.metadata?.stack].join(' ').toLowerCase();
      return hay.contains(q);
    }).toList();
    out.sort(_comparator);
    return out;
  }
```
(Leave `_comparator` and `_days` unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/projects/project_query_test.dart`
Expected: PASS (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/projects/project_query.dart test/projects/project_query_test.dart && git commit -m "feat: ProjectQuery type and readiness-range filters"
```

---

## Task 2: ProjectsScreen — 타입 칩 + 준비도 슬라이더

**Files:**
- Modify: `lib/projects/projects_screen.dart`
- Test: `test/projects/projects_screen_test.dart`

- [ ] **Step 1: Write the failing widget test**

In `test/projects/projects_screen_test.dart`, change `_twoProjects` to include distinct types and a readiness gap, and add a type-chip test. Replace the `_twoProjects` constant:
```dart
const _twoProjects =
    '{"projects":[{"id":"alpha","name":"alpha","type":"node","priority":"LOW","readiness":30},{"id":"beta","name":"beta","type":"dart","priority":"CRITICAL","readiness":90,"activity":{"isActive":true,"daysSinceLastCommit":1}}]}';
```
Add these tests inside `main()`:
```dart
  testWidgets('type chip narrows the list to that type', (tester) async {
    final c = memContainer();
    addTearDown(c.dispose);
    await c.read(repositoryProvider).saveSnapshot(_twoProjects);
    await tester.pumpWidget(host(c));
    await tester.pumpAndSettle();
    expect(find.byType(ProjectCard), findsNWidgets(2));

    await tester.tap(find.widgetWithText(FilterChip, 'node'));
    await tester.pumpAndSettle();
    expect(find.byType(ProjectCard), findsOneWidget);
    expect(find.widgetWithText(ProjectCard, 'alpha'), findsOneWidget);
  });

  testWidgets('readiness range slider is present', (tester) async {
    final c = memContainer();
    addTearDown(c.dispose);
    await c.read(repositoryProvider).saveSnapshot(_twoProjects);
    await tester.pumpWidget(host(c));
    await tester.pumpAndSettle();
    expect(find.byType(RangeSlider), findsOneWidget);
  });
```
(The file already imports material, ProjectCard, etc. `FilterChip` and `RangeSlider` come from `package:flutter/material.dart`, already imported.)

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/projects/projects_screen_test.dart`
Expected: FAIL — no `node` FilterChip, no RangeSlider.

- [ ] **Step 3: Add type chips + slider to the screen**

In `lib/projects/projects_screen.dart`, inside the `data:` builder, compute the available types from the full project list (before filtering). Find where `final results = query.apply(scan.projects);` is and add right after it:
```dart
          final results = query.apply(scan.projects);
          final allTypes = scan.projects.map((p) => p.type).toSet().toList()
            ..sort();
```
Then insert two widgets between `_FilterChips(query: query),` and the `Expanded(` in the Column children:
```dart
              _FilterChips(query: query),
              _TypeChips(query: query, types: allTypes),
              _ReadinessSlider(query: query),
              Expanded(
```

Add two new widgets at the bottom of the file (after `_FilterChips`):
```dart
class _TypeChips extends ConsumerWidget {
  final ProjectQuery query;
  final List<String> types;
  const _TypeChips({required this.query, required this.types});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (types.isEmpty) return const SizedBox.shrink();
    void toggle(String t) {
      final next = {...query.types};
      next.contains(t) ? next.remove(t) : next.add(t);
      ref.read(projectQueryProvider.notifier).update((q) => q.copyWith(types: next));
    }

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        children: [
          for (final t in types)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: FilterChip(
                label: Text(t),
                selected: query.types.contains(t),
                onSelected: (_) => toggle(t),
              ),
            ),
        ],
      ),
    );
  }
}

class _ReadinessSlider extends ConsumerWidget {
  final ProjectQuery query;
  const _ReadinessSlider({required this.query});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        children: [
          Text('준비도 ${query.minReadiness}–${query.maxReadiness}',
              style: Theme.of(context).textTheme.bodySmall),
          Expanded(
            child: RangeSlider(
              min: 0,
              max: 100,
              divisions: 20,
              values: RangeValues(
                query.minReadiness.toDouble(),
                query.maxReadiness.toDouble(),
              ),
              labels: RangeLabels(
                '${query.minReadiness}',
                '${query.maxReadiness}',
              ),
              onChanged: (v) => ref.read(projectQueryProvider.notifier).update(
                    (q) => q.copyWith(
                      minReadiness: v.start.round(),
                      maxReadiness: v.end.round(),
                    ),
                  ),
            ),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/projects/projects_screen_test.dart`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Full suite + analyze**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test ; echo test_exit=$? ; flutter analyze ; echo analyze_exit=$?`
Expected: all tests PASS, `No issues found!`.

- [ ] **Step 6: Commit + push**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add -A && git commit -m "feat: Projects type chips and readiness-range slider" && git push origin main
```

---

## Self-Review 메모

- **스펙 §2/§5 커버리지:** `ProjectQuery` types/min/maxReadiness + apply/copyWith(Task 1) / 타입 칩·RangeSlider UI(Task 2) / 순수 필터 테스트 + 위젯 테스트(Task 1·2) 모두 태스크 존재.
- **타입 일관성:** `ProjectQuery{...,types:Set<String>,minReadiness:int,maxReadiness:int}` + `copyWith`(Task 1) → `_TypeChips`/`_ReadinessSlider`가 동일 필드 소비(Task 2). 기존 `projectQueryProvider.update`/`copyWith` 패턴 재사용.
- **타입 목록 동적:** `scan.projects`(필터 전 전체)에서 distinct type → 필터로 사라진 타입도 재선택 가능.
- **search 단락 주의:** type/readiness 체크를 `if (q.isEmpty) return true;` **앞**에 넣어 검색 유무와 무관하게 적용.
- **위젯 테스트 정직성:** 타입 칩 탭 → 필터링은 실제 검증; RangeSlider 드래그는 flaky하므로 존재만 확인하고 범위 로직은 Task 1 순수 테스트로 커버.
