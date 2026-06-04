# 모바일 앱 Projects 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 최신 스냅샷의 프로젝트를 검색·필터(우선순위/활성)·정렬해 카드 리스트로 보여주고, 카드 탭 시 상세 화면으로 이동하며, Dashboard와 Projects를 하단 네비게이션으로 전환한다.

**Architecture:** 순수 클래스 `ProjectQuery`가 검색어·필터·정렬을 담고 `apply(List<Project>)`로 필터+정렬된 리스트를 만든다(테스트 집중). 화면은 `projectQueryProvider`(StateProvider)를 watch해 결과만 렌더링한다. 상세는 Navigator push, 탭 전환은 `HomeShell`의 NavigationBar.

**Tech Stack:** Flutter, Riverpod, flutter_test.

> **앱 위치:** `/Users/jean325/portfolio/projects/pt-mobile/`. 모든 경로는 이 디렉토리 기준.
>
> **환경:** Flutter/Dart는 PATH에 없다. 모든 명령 앞에 같은 줄에서 `export PATH="$PATH:/Users/jean325/development/flutter/bin" && ` 를 붙인다. Dart 3.11.5.

## 기존 코드 (이미 존재)

- `lib/models/project.dart` — `Project{id,name,path,type,priority(Priority enum),readiness,baseReadiness,progress?(Progress{percentage,source?,confidence?,signals}),activity?(Activity{lastCommitDate?,lastCommitMessage?,commitsInLastWeek,isActive,daysSinceLastCommit}),metadata?(Metadata{description?,stack,hasReadme,hasClaude,hasGit}),nextActions,issues}`.
- `lib/models/scan_result.dart` — `ScanResult{projects, scannedAt?, summary}`.
- `lib/providers.dart` — `latestSnapshotProvider:FutureProvider<ScanResult?>`, `repositoryProvider`, `dataSourceProvider`, `databaseProvider`.
- `lib/dashboard/dashboard_screen.dart` — `DashboardScreen`(ConsumerWidget, AppBar 'Dashboard', import FAB, 빈 상태), `DashboardApp`.
- `lib/data/database_connection.dart` — `openConnection({inMemory})`.
- `lib/main.dart` — `PtMobileApp`(home: `DashboardScreen`).
- 테스트 패턴: `ProviderContainer(overrides:[databaseProvider.overrideWith(... openConnection(inMemory:true) ...)])` + `UncontrolledProviderScope`.

---

## File Structure

| 파일 | 책임 |
|------|------|
| `lib/projects/project_query.dart` | (신규) 검색·필터·정렬 순수 로직 |
| `lib/projects/project_card.dart` | (신규) 프로젝트 1건 카드 위젯 |
| `lib/projects/projects_screen.dart` | (신규) 검색바+필터칩+정렬+리스트 |
| `lib/projects/project_detail_screen.dart` | (신규) 프로젝트 상세 |
| `lib/projects/project_providers.dart` | (신규) `projectQueryProvider` |
| `lib/shell/home_shell.dart` | (신규) NavigationBar로 Dashboard/Projects 전환 |
| `lib/main.dart` | (수정) home을 `HomeShell`로 |
| `test/projects/project_query_test.dart` | 순수 로직 테스트 |
| `test/projects/project_card_test.dart` | 카드 위젯 테스트 |
| `test/projects/projects_screen_test.dart` | 화면 테스트 (빈/검색/필터) |
| `test/projects/project_detail_screen_test.dart` | 상세 테스트 |
| `test/shell/home_shell_test.dart` | 탭 전환 테스트 |

---

## Task 1: ProjectQuery (검색·필터·정렬 순수 로직)

**Files:**
- Create: `lib/projects/project_query.dart`
- Test: `test/projects/project_query_test.dart`

- [ ] **Step 1: Write the failing test**

`test/projects/project_query_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/models/project.dart';
import 'package:pt_mobile/projects/project_query.dart';

Project p({
  String name = 'x',
  String path = '/x',
  Priority priority = Priority.low,
  int readiness = 0,
  int progress = 0,
  int days = 0,
  bool active = false,
  List<String> stack = const [],
  bool hasActivity = true,
}) =>
    Project(
      id: name,
      name: name,
      path: path,
      priority: priority,
      readiness: readiness,
      progress: Progress(percentage: progress),
      activity: hasActivity
          ? Activity(isActive: active, daysSinceLastCommit: days)
          : null,
      metadata: Metadata(stack: stack),
    );

void main() {
  final sample = [
    p(name: 'alpha', readiness: 30, progress: 10, days: 40, priority: Priority.low, stack: ['node']),
    p(name: 'beta', path: '/work/beta', readiness: 90, progress: 80, days: 1, active: true, priority: Priority.critical, stack: ['flutter']),
    p(name: 'gamma', readiness: 60, progress: 50, days: 5, active: true, priority: Priority.high),
  ];

  test('empty query returns all, sorted by readiness desc by default', () {
    final out = const ProjectQuery().apply(sample);
    expect(out.map((e) => e.name), ['beta', 'gamma', 'alpha']);
  });

  test('search matches name, path or stack (case-insensitive)', () {
    expect(const ProjectQuery(search: 'BETA').apply(sample).map((e) => e.name), ['beta']);
    expect(const ProjectQuery(search: '/work').apply(sample).map((e) => e.name), ['beta']);
    expect(const ProjectQuery(search: 'node').apply(sample).map((e) => e.name), ['alpha']);
  });

  test('priority filter keeps only selected priorities', () {
    final out = ProjectQuery(priorities: {Priority.critical, Priority.high}).apply(sample);
    expect(out.map((e) => e.name), ['beta', 'gamma']);
  });

  test('activeOnly keeps only active projects', () {
    final out = const ProjectQuery(activeOnly: true).apply(sample);
    expect(out.map((e) => e.name).toSet(), {'beta', 'gamma'});
  });

  test('sort by progress desc', () {
    final out = const ProjectQuery(sort: ProjectSort.progressDesc).apply(sample);
    expect(out.map((e) => e.name), ['beta', 'gamma', 'alpha']);
  });

  test('sort by recent activity puts missing-activity last', () {
    final withMissing = [
      ...sample,
      p(name: 'delta', hasActivity: false),
    ];
    final out = const ProjectQuery(sort: ProjectSort.recentActivity).apply(withMissing);
    expect(out.first.name, 'beta'); // 1 day
    expect(out.last.name, 'delta'); // unknown activity → last
  });

  test('copyWith overrides only given fields', () {
    const q = ProjectQuery(search: 'a', activeOnly: true);
    final q2 = q.copyWith(search: 'b');
    expect(q2.search, 'b');
    expect(q2.activeOnly, true);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/projects/project_query_test.dart`
Expected: FAIL — `project_query.dart` 없음.

- [ ] **Step 3: Implement `lib/projects/project_query.dart`**

```dart
import '../models/project.dart';

enum ProjectSort { readinessDesc, progressDesc, recentActivity, nameAsc }

class ProjectQuery {
  final String search;
  final Set<Priority> priorities; // empty = all priorities
  final bool activeOnly;
  final ProjectSort sort;

  const ProjectQuery({
    this.search = '',
    this.priorities = const {},
    this.activeOnly = false,
    this.sort = ProjectSort.readinessDesc,
  });

  ProjectQuery copyWith({
    String? search,
    Set<Priority>? priorities,
    bool? activeOnly,
    ProjectSort? sort,
  }) =>
      ProjectQuery(
        search: search ?? this.search,
        priorities: priorities ?? this.priorities,
        activeOnly: activeOnly ?? this.activeOnly,
        sort: sort ?? this.sort,
      );

  List<Project> apply(List<Project> projects) {
    final q = search.trim().toLowerCase();
    final out = projects.where((p) {
      if (priorities.isNotEmpty && !priorities.contains(p.priority)) return false;
      if (activeOnly && !(p.activity?.isActive ?? false)) return false;
      if (q.isEmpty) return true;
      final hay = [p.name, p.path, ...?p.metadata?.stack].join(' ').toLowerCase();
      return hay.contains(q);
    }).toList();
    out.sort(_comparator);
    return out;
  }

  int _comparator(Project a, Project b) {
    switch (sort) {
      case ProjectSort.readinessDesc:
        return b.readiness.compareTo(a.readiness);
      case ProjectSort.progressDesc:
        return (b.progress?.percentage ?? 0).compareTo(a.progress?.percentage ?? 0);
      case ProjectSort.recentActivity:
        return _days(a).compareTo(_days(b));
      case ProjectSort.nameAsc:
        return a.name.toLowerCase().compareTo(b.name.toLowerCase());
    }
  }

  // Missing activity sorts last (treated as most stale / unknown).
  int _days(Project p) => p.activity?.daysSinceLastCommit ?? (1 << 30);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/projects/project_query_test.dart`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/projects/project_query.dart test/projects/project_query_test.dart && git commit -m "feat: ProjectQuery search/filter/sort logic"
```

---

## Task 2: ProjectCard 위젯

**Files:**
- Create: `lib/projects/project_card.dart`
- Test: `test/projects/project_card_test.dart`

- [ ] **Step 1: Write the failing test**

`test/projects/project_card_test.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/models/project.dart';
import 'package:pt_mobile/projects/project_card.dart';

void main() {
  testWidgets('shows name, priority and readiness; fires onTap', (tester) async {
    var tapped = false;
    final project = Project(
      id: 'a',
      name: 'alpha',
      priority: Priority.critical,
      readiness: 77,
      progress: Progress(percentage: 60),
      activity: Activity(daysSinceLastCommit: 3),
      issues: const ['no readme'],
    );
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ProjectCard(project: project, onTap: () => tapped = true),
      ),
    ));
    expect(find.text('alpha'), findsOneWidget);
    expect(find.text('CRITICAL'), findsOneWidget);
    expect(find.textContaining('77'), findsWidgets);
    await tester.tap(find.byType(ProjectCard));
    expect(tapped, isTrue);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/projects/project_card_test.dart`
Expected: FAIL — `project_card.dart` 없음.

- [ ] **Step 3: Implement `lib/projects/project_card.dart`**

```dart
import 'package:flutter/material.dart';
import '../models/project.dart';

class ProjectCard extends StatelessWidget {
  final Project project;
  final VoidCallback onTap;
  const ProjectCard({super.key, required this.project, required this.onTap});

  static const _priorityLabels = {
    Priority.critical: 'CRITICAL',
    Priority.high: 'HIGH',
    Priority.medium: 'MEDIUM',
    Priority.low: 'LOW',
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final days = project.activity?.daysSinceLastCommit;
    final subtitleParts = <String>[
      '준비도 ${project.readiness}',
      '진행률 ${project.progress?.percentage ?? 0}%',
      if (days != null) '${days}일 전' else '활동 미상',
    ];
    return Card(
      child: ListTile(
        onTap: onTap,
        title: Text(project.name),
        subtitle: Text(subtitleParts.join(' · ')),
        leading: _PriorityBadge(label: _priorityLabels[project.priority]!),
        trailing: project.issues.isEmpty
            ? null
            : Text('⚠ ${project.issues.length}',
                style: theme.textTheme.bodySmall),
      ),
    );
  }
}

class _PriorityBadge extends StatelessWidget {
  final String label;
  const _PriorityBadge({required this.label});
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.secondaryContainer,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(label, style: const TextStyle(fontSize: 10)),
      );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/projects/project_card_test.dart`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/projects/project_card.dart test/projects/project_card_test.dart && git commit -m "feat: ProjectCard widget"
```

---

## Task 3: ProjectsScreen (검색 + 필터 + 정렬 + 리스트)

**Files:**
- Create: `lib/projects/project_providers.dart`
- Create: `lib/projects/projects_screen.dart`
- Test: `test/projects/projects_screen_test.dart`

- [ ] **Step 1: Create the query provider**

`lib/projects/project_providers.dart`:
```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'project_query.dart';

final projectQueryProvider =
    StateProvider<ProjectQuery>((ref) => const ProjectQuery());
```

- [ ] **Step 2: Write the failing test**

`test/projects/projects_screen_test.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/data/database_connection.dart';
import 'package:pt_mobile/data/snapshot_database.dart';
import 'package:pt_mobile/projects/project_card.dart';
import 'package:pt_mobile/projects/projects_screen.dart';
import 'package:pt_mobile/providers.dart';

ProviderContainer memContainer() => ProviderContainer(overrides: [
      databaseProvider.overrideWith((ref) {
        final db = SnapshotDatabase(openConnection(inMemory: true));
        ref.onDispose(db.close);
        return db;
      }),
    ]);

Widget host(ProviderContainer c) => UncontrolledProviderScope(
      container: c,
      child: const MaterialApp(home: ProjectsScreen()),
    );

const _twoProjects =
    '{"projects":[{"id":"alpha","name":"alpha","priority":"LOW","readiness":30},{"id":"beta","name":"beta","priority":"CRITICAL","readiness":90,"activity":{"isActive":true,"daysSinceLastCommit":1}}]}';

void main() {
  testWidgets('empty state when no snapshot', (tester) async {
    final c = memContainer();
    addTearDown(c.dispose);
    await tester.pumpWidget(host(c));
    await tester.pumpAndSettle();
    expect(find.textContaining('가져오'), findsOneWidget);
  });

  testWidgets('lists projects and filters by search', (tester) async {
    final c = memContainer();
    addTearDown(c.dispose);
    await c.read(repositoryProvider).saveSnapshot(_twoProjects);
    await tester.pumpWidget(host(c));
    await tester.pumpAndSettle();
    expect(find.byType(ProjectCard), findsNWidgets(2));

    await tester.enterText(find.byType(TextField), 'beta');
    await tester.pumpAndSettle();
    expect(find.byType(ProjectCard), findsOneWidget);
    expect(find.text('beta'), findsOneWidget);
  });
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/projects/projects_screen_test.dart`
Expected: FAIL — `projects_screen.dart` 없음.

- [ ] **Step 4: Implement `lib/projects/projects_screen.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/project.dart';
import '../providers.dart';
import 'project_card.dart';
import 'project_detail_screen.dart';
import 'project_providers.dart';
import 'project_query.dart';

class ProjectsScreen extends ConsumerWidget {
  const ProjectsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final latest = ref.watch(latestSnapshotProvider);
    final query = ref.watch(projectQueryProvider);
    return latest.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('오류: $e')),
      data: (scan) {
        if (scan == null || scan.projects.isEmpty) {
          return const Center(child: Text('스캔 결과를 가져오세요 (Dashboard 탭)'));
        }
        final results = query.apply(scan.projects);
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      decoration: const InputDecoration(
                        prefixIcon: Icon(Icons.search),
                        hintText: '이름·경로·스택 검색',
                        isDense: true,
                        border: OutlineInputBorder(),
                      ),
                      onChanged: (v) => ref
                          .read(projectQueryProvider.notifier)
                          .update((q) => q.copyWith(search: v)),
                    ),
                  ),
                  PopupMenuButton<ProjectSort>(
                    icon: const Icon(Icons.sort),
                    onSelected: (s) => ref
                        .read(projectQueryProvider.notifier)
                        .update((q) => q.copyWith(sort: s)),
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: ProjectSort.readinessDesc, child: Text('준비도순')),
                      PopupMenuItem(value: ProjectSort.progressDesc, child: Text('진행률순')),
                      PopupMenuItem(value: ProjectSort.recentActivity, child: Text('최근 활동순')),
                      PopupMenuItem(value: ProjectSort.nameAsc, child: Text('이름순')),
                    ],
                  ),
                ],
              ),
            ),
            _FilterChips(query: query),
            Expanded(
              child: results.isEmpty
                  ? const Center(child: Text('조건에 맞는 프로젝트가 없습니다'))
                  : ListView.builder(
                      itemCount: results.length,
                      itemBuilder: (context, i) {
                        final project = results[i];
                        return ProjectCard(
                          project: project,
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => ProjectDetailScreen(project: project),
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ],
        );
      },
    );
  }
}

class _FilterChips extends ConsumerWidget {
  final ProjectQuery query;
  const _FilterChips({required this.query});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    void togglePriority(Priority p) {
      final next = {...query.priorities};
      next.contains(p) ? next.remove(p) : next.add(p);
      ref.read(projectQueryProvider.notifier).update((q) => q.copyWith(priorities: next));
    }

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        children: [
          for (final p in Priority.values)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: FilterChip(
                label: Text(p.name),
                selected: query.priorities.contains(p),
                onSelected: (_) => togglePriority(p),
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(right: 6),
            child: FilterChip(
              label: const Text('활성'),
              selected: query.activeOnly,
              onSelected: (v) => ref
                  .read(projectQueryProvider.notifier)
                  .update((q) => q.copyWith(activeOnly: v)),
            ),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/projects/projects_screen_test.dart`
Expected: PASS (2 tests). (`project_detail_screen.dart` is created in Task 4; until then this file won't compile — implement Task 4 first if running standalone, OR add a temporary stub. To keep ordering simple, create the Task 4 file before running this step.)

> **Ordering note:** `projects_screen.dart` imports `project_detail_screen.dart`. Implement Task 4's `project_detail_screen.dart` immediately after Step 4 here (before running Step 5), then run both test files. The commits stay separate.

- [ ] **Step 6: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/projects/project_providers.dart lib/projects/projects_screen.dart test/projects/projects_screen_test.dart && git commit -m "feat: ProjectsScreen with search, filter chips and sort"
```

---

## Task 4: ProjectDetailScreen

**Files:**
- Create: `lib/projects/project_detail_screen.dart`
- Test: `test/projects/project_detail_screen_test.dart`

> 작성 순서상 이 파일은 Task 3 Step 4 직후(= Task 3 Step 5 실행 전)에 만든다. 테스트/커밋은 별도로 유지.

- [ ] **Step 1: Write the failing test**

`test/projects/project_detail_screen_test.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/models/project.dart';
import 'package:pt_mobile/projects/project_detail_screen.dart';

void main() {
  testWidgets('renders core fields, next actions and issues', (tester) async {
    final project = Project(
      id: 'a',
      name: 'alpha',
      path: '/Users/x/alpha',
      type: 'node',
      priority: Priority.high,
      readiness: 77,
      baseReadiness: 70,
      progress: Progress(percentage: 60),
      activity: Activity(daysSinceLastCommit: 3, isActive: true),
      metadata: Metadata(description: 'demo', stack: const ['node', 'docker']),
      nextActions: const ['write tests', 'add readme'],
      issues: const ['no readme'],
    );
    await tester.pumpWidget(MaterialApp(home: ProjectDetailScreen(project: project)));
    expect(find.text('alpha'), findsWidgets);
    expect(find.text('/Users/x/alpha'), findsOneWidget);
    expect(find.textContaining('77'), findsWidgets);
    expect(find.text('write tests'), findsOneWidget);
    expect(find.text('no readme'), findsOneWidget);
    expect(find.text('node'), findsWidgets);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/projects/project_detail_screen_test.dart`
Expected: FAIL — `project_detail_screen.dart` 없음.

- [ ] **Step 3: Implement `lib/projects/project_detail_screen.dart`**

```dart
import 'package:flutter/material.dart';
import '../models/project.dart';

class ProjectDetailScreen extends StatelessWidget {
  final Project project;
  const ProjectDetailScreen({super.key, required this.project});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final a = project.activity;
    final m = project.metadata;
    return Scaffold(
      appBar: AppBar(title: Text(project.name)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(project.name, style: theme.textTheme.headlineSmall),
          const SizedBox(height: 4),
          SelectableText(project.path),
          const SizedBox(height: 16),
          _kv('타입', project.type),
          _kv('우선순위', project.priority.name),
          _kv('준비도', '${project.readiness} (base ${project.baseReadiness})'),
          _kv('진행률', '${project.progress?.percentage ?? 0}%'),
          if (a != null) ...[
            _kv('활성', a.isActive ? '예' : '아니오'),
            _kv('마지막 커밋', '${a.daysSinceLastCommit}일 전'),
          ],
          if (m != null) ...[
            if (m.description != null) _kv('설명', m.description!),
            _kv('스택', m.stack.isEmpty ? '-' : m.stack.join(', ')),
          ],
          const SizedBox(height: 16),
          _section(theme, '다음 작업', project.nextActions, '없음'),
          const SizedBox(height: 12),
          _section(theme, '이슈', project.issues, '없음'),
        ],
      ),
    );
  }

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(width: 88, child: Text(k)),
            Expanded(child: Text(v)),
          ],
        ),
      );

  Widget _section(ThemeData theme, String title, List<String> items, String empty) =>
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          if (items.isEmpty)
            Text(empty)
          else
            for (final it in items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Text('• $it'),
              ),
        ],
      );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/projects/project_detail_screen_test.dart`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/projects/project_detail_screen.dart test/projects/project_detail_screen_test.dart && git commit -m "feat: ProjectDetailScreen"
```

---

## Task 5: HomeShell (Dashboard ↔ Projects 탭)

**Files:**
- Create: `lib/shell/home_shell.dart`
- Modify: `lib/main.dart`
- Test: `test/shell/home_shell_test.dart`

- [ ] **Step 1: Write the failing test**

`test/shell/home_shell_test.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/data/database_connection.dart';
import 'package:pt_mobile/data/snapshot_database.dart';
import 'package:pt_mobile/projects/projects_screen.dart';
import 'package:pt_mobile/shell/home_shell.dart';

ProviderContainer memContainer() => ProviderContainer(overrides: [
      databaseProvider.overrideWith((ref) {
        final db = SnapshotDatabase(openConnection(inMemory: true));
        ref.onDispose(db.close);
        return db;
      }),
    ]);

void main() {
  testWidgets('switches from Dashboard to Projects via nav bar', (tester) async {
    final c = memContainer();
    addTearDown(c.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: c,
      child: const MaterialApp(home: HomeShell()),
    ));
    await tester.pumpAndSettle();

    // Dashboard tab active by default.
    expect(find.text('Dashboard'), findsWidgets);
    expect(find.byType(ProjectsScreen), findsNothing);

    await tester.tap(find.text('Projects'));
    await tester.pumpAndSettle();
    expect(find.byType(ProjectsScreen), findsOneWidget);
  });
}
```
(Note: `databaseProvider` is referenced via the import of `package:pt_mobile/providers.dart` transitively through the screens; add `import 'package:pt_mobile/providers.dart';` to the test for the symbol.)

- [ ] **Step 2: Add the providers import to the test**

At the top of `test/shell/home_shell_test.dart` add:
```dart
import 'package:pt_mobile/providers.dart';
```

- [ ] **Step 3: Run test to verify it fails**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/shell/home_shell_test.dart`
Expected: FAIL — `home_shell.dart` 없음.

- [ ] **Step 4: Implement `lib/shell/home_shell.dart`**

```dart
import 'package:flutter/material.dart';
import '../dashboard/dashboard_screen.dart';
import '../projects/projects_screen.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  static const _titles = ['Dashboard', 'Projects'];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_titles[_index])),
      body: IndexedStack(
        index: _index,
        children: const [
          _DashboardBody(),
          ProjectsScreen(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard), label: 'Dashboard'),
          NavigationDestination(icon: Icon(Icons.list), label: 'Projects'),
        ],
      ),
    );
  }
}

/// Dashboard content without its own Scaffold/AppBar (the shell provides those).
class _DashboardBody extends StatelessWidget {
  const _DashboardBody();
  @override
  Widget build(BuildContext context) => const DashboardScreen();
}
```

> **주의:** `DashboardScreen`은 자체 `Scaffold`(AppBar 'Dashboard' + import FAB)를 가진다. 셸의 `Scaffold` 안에 또 `Scaffold`가 들어가는 형태가 되는데, Flutter에서 중첩 Scaffold는 허용되며 안쪽 FAB/AppBar가 그대로 동작한다. 셸 AppBar와 Dashboard AppBar가 이중으로 보이지 않게, 이 Task의 셸 `AppBar`는 유지하되 `DashboardScreen`을 그대로 재사용한다(테스트는 'Dashboard' 텍스트가 findsWidgets로 1개 이상이면 통과). Projects 탭에는 별도 AppBar가 없으므로 셸 AppBar가 타이틀을 제공한다.

- [ ] **Step 5: Run test to verify it passes**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/shell/home_shell_test.dart`
Expected: PASS (1 test).

- [ ] **Step 6: Point `main.dart` at HomeShell**

Replace `lib/main.dart` with:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'shell/home_shell.dart';

void main() => runApp(const ProviderScope(child: PtMobileApp()));

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

- [ ] **Step 7: Run full suite + analyze**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test && flutter analyze`
Expected: all tests PASS, `No issues found!`.

- [ ] **Step 8: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add -A && git commit -m "feat: HomeShell nav bar wiring Dashboard and Projects"
```

---

## Self-Review 메모

- **스펙 §5.2 커버리지:** 검색(이름/경로/스택, Task 1·3) / 필터(priority, active, Task 1·3) / 정렬(준비도·진행률·최근활동·이름, Task 1·3) / 카드 리스트(Task 2·3) / 상세(전체 필드 + nextActions + issues, Task 4) / 네비게이션(Task 5) 모두 태스크 존재.
- **타입 일관성:** `ProjectQuery{search, priorities:Set<Priority>, activeOnly, sort:ProjectSort}` + `copyWith` + `apply`는 Task 1 정의 후 Task 3에서 소비. `projectQueryProvider`(StateProvider) Task 3 정의. `ProjectCard({project,onTap})`, `ProjectDetailScreen({project})` 시그니처 일관. 기존 `Project`/`Activity`/`Metadata`/`latestSnapshotProvider`/`databaseProvider`/`openConnection` 재사용 시그니처 일치.
- **빌드 순서 주의:** `projects_screen.dart`가 `project_detail_screen.dart`를 import하므로 Task 4 파일을 Task 3 Step 5 실행 전에 생성(메모 명시). 커밋은 분리.
- **중첩 Scaffold:** HomeShell이 자체 AppBar를 두고 DashboardScreen(자체 Scaffold/FAB 보유)을 재사용 — 허용되는 패턴. 후속 슬라이스에서 Dashboard를 body-only로 리팩터링할 여지 있음(현재 범위 밖, YAGNI).
- **스펙 대비 축소(의도):** type 필터, 준비도 구간 필터는 이번 슬라이스에서 제외(검색+우선순위+활성+정렬로 충분). 필요 시 후속에 추가. continuity 표시는 모델에 필드가 아직 없어 제외.
- **연기:** Recommendations/Trends/Notifications는 후속 플랜.
```
