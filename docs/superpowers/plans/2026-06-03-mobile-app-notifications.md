# 모바일 앱 Notifications 화면 Implementation Plan (마지막 슬라이스)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 최신/직전 스냅샷을 비교해 6종 로컬 알림 트리거를 순수 함수로 판정하고, 발생 이벤트를 히스토리에 적재하며, 트리거별 on/off 설정을 영속한다. 화면에서 히스토리와 설정을 보여주고 "지금 평가"로 트리거를 실행한다. OS 전달은 `LocalNotifier` 시임 뒤로 best-effort.

**Architecture:** `NotificationRules.evaluate(latest, previous, settings, now)`가 순수하게 이벤트 목록을 만든다(테스트 집중). `NotificationSettingsStore`/`NotificationHistoryStore`는 shared_preferences에 영속. `NotificationService.evaluateAndRecord`가 평가→히스토리 적재→`LocalNotifier.show`를 수행한다. 화면은 히스토리 리스트 + 설정 토글 + "지금 평가" 버튼. Notifications 탭을 HomeShell에 추가.

**Tech Stack:** Flutter, Riverpod, shared_preferences, flutter_test.

> **앱 위치:** `/Users/jean325/portfolio/projects/pt-mobile/`. 모든 경로 상대.
>
> **환경:** Flutter/Dart는 PATH에 없다. 모든 명령 앞에 같은 줄에서 `export PATH="$PATH:/Users/jean325/development/flutter/bin" && `. Dart 3.11.5. 명령 종료코드를 확인할 것(파이프가 exit code 가리지 않도록 `; echo exit=$?`).

> **의도된 결정 (NOT 이슈):** 실제 OS 알림 전달(`flutter_local_notifications`)은 무기기 환경에서 검증 불가하므로 `LocalNotifier` 인터페이스 뒤로 분리하고 기본 구현은 `NoopLocalNotifier`(히스토리 적재만)로 둔다. 플러그인 백엔드는 문서화된 후속. 트리거 판정·히스토리·설정이 이 슬라이스의 전달·검증되는 핵심. (이전 슬라이스의 실용 재해석과 일관 — 예: 활동 히트맵)

## 기존 코드 (이미 존재)

- `lib/models/scan_result.dart` — `ScanResult{projects, scannedAt?, summary}`.
- `lib/models/project.dart` — `Project{id,name,progress?(percentage),activity?(daysSinceLastCommit,commitsInLastWeek,isActive),issues,...}`.
- `lib/recommendations/recommendation_engine.dart` — `RecommendationEngine.recommend(projects, weights, limit)`; `lib/recommendations/recommendation_weights.dart` — `RecommendationWeights.defaults`.
- `lib/data/snapshot_repository.dart` — `history():Future<List<ScanResult>>`(newest-first).
- `lib/providers.dart` — `repositoryProvider`, `databaseProvider`, `latestSnapshotProvider`.
- `lib/shell/home_shell.dart` — `_screens=[Dashboard,Projects,Recommendations,Trends]`, 4 destinations. 활성 화면만 마운트.
- `lib/recommendations/recommendation_providers.dart` — `interactionStoreProvider`(override 필요; HomeShell 테스트는 이미 주입).
- shared_preferences 의존성 존재.

---

## File Structure

| 파일 | 책임 |
|------|------|
| `lib/notifications/notification_event.dart` | (신규) `NotificationTrigger` enum + `NotificationEvent`(+json) |
| `lib/notifications/notification_settings.dart` | (신규) 트리거별 on/off + copyWith |
| `lib/notifications/notification_settings_store.dart` | (신규) 설정 영속(shared_prefs) |
| `lib/notifications/notification_history_store.dart` | (신규) 이벤트 히스토리 영속(shared_prefs) |
| `lib/notifications/notification_rules.dart` | (신규) 6종 트리거 순수 판정 |
| `lib/notifications/local_notifier.dart` | (신규) `LocalNotifier` 인터페이스 + `NoopLocalNotifier` |
| `lib/notifications/notification_service.dart` | (신규) evaluate→record→notify |
| `lib/notifications/notification_providers.dart` | (신규) providers |
| `lib/notifications/notifications_screen.dart` | (신규) 히스토리 + 설정 + "지금 평가" |
| `lib/shell/home_shell.dart` | (수정) Notifications 탭 |
| `lib/main.dart` | (수정) settings/history store override |
| 각 `test/notifications/*_test.dart`, `test/shell/home_shell_test.dart` | 테스트 |

---

## Task 1: NotificationTrigger + NotificationEvent

**Files:**
- Create: `lib/notifications/notification_event.dart`
- Test: `test/notifications/notification_event_test.dart`

- [ ] **Step 1: Write the failing test**

`test/notifications/notification_event_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/notifications/notification_event.dart';

void main() {
  test('round-trips through json', () {
    final e = NotificationEvent(
      trigger: NotificationTrigger.ninetyComplete,
      title: 'done',
      body: 'alpha 95%',
      at: DateTime.parse('2026-06-03T09:00:00.000Z'),
    );
    final back = NotificationEvent.fromJson(e.toJson());
    expect(back.trigger, NotificationTrigger.ninetyComplete);
    expect(back.title, 'done');
    expect(back.body, 'alpha 95%');
    expect(back.at, e.at);
  });

  test('unknown trigger name falls back to weeklyReport', () {
    final back = NotificationEvent.fromJson({
      'trigger': 'bogus',
      'title': 't',
      'body': 'b',
      'at': '2026-06-03T09:00:00.000Z',
    });
    expect(back.trigger, NotificationTrigger.weeklyReport);
  });
}
```

- [ ] **Step 2: Run, verify FAIL**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/notifications/notification_event_test.dart`

- [ ] **Step 3: Implement `lib/notifications/notification_event.dart`**

```dart
enum NotificationTrigger {
  todayRecommendation,
  weeklyReport,
  idle,
  ninetyComplete,
  weeklyActive,
  newIssue,
}

NotificationTrigger triggerFromName(String? name) =>
    NotificationTrigger.values.firstWhere(
      (t) => t.name == name,
      orElse: () => NotificationTrigger.weeklyReport,
    );

class NotificationEvent {
  final NotificationTrigger trigger;
  final String title;
  final String body;
  final DateTime at;

  NotificationEvent({
    required this.trigger,
    required this.title,
    required this.body,
    required this.at,
  });

  Map<String, dynamic> toJson() => {
        'trigger': trigger.name,
        'title': title,
        'body': body,
        'at': at.toIso8601String(),
      };

  factory NotificationEvent.fromJson(Map<String, dynamic> j) => NotificationEvent(
        trigger: triggerFromName(j['trigger'] as String?),
        title: j['title']?.toString() ?? '',
        body: j['body']?.toString() ?? '',
        at: DateTime.tryParse(j['at']?.toString() ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0),
      );
}
```

- [ ] **Step 4: Run, verify PASS (2 tests)**

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/notifications/notification_event.dart test/notifications/notification_event_test.dart && git commit -m "feat: NotificationEvent and trigger enum"
```

---

## Task 2: NotificationSettings

**Files:**
- Create: `lib/notifications/notification_settings.dart`
- Test: `test/notifications/notification_settings_test.dart`

- [ ] **Step 1: Write the failing test**

`test/notifications/notification_settings_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/notifications/notification_event.dart';
import 'package:pt_mobile/notifications/notification_settings.dart';

void main() {
  test('defaults enable every trigger', () {
    const s = NotificationSettings.allOn();
    for (final t in NotificationTrigger.values) {
      expect(s.isEnabled(t), isTrue);
    }
  });

  test('withTrigger toggles one trigger, leaving others', () {
    const s = NotificationSettings.allOn();
    final s2 = s.withTrigger(NotificationTrigger.idle, false);
    expect(s2.isEnabled(NotificationTrigger.idle), isFalse);
    expect(s2.isEnabled(NotificationTrigger.newIssue), isTrue);
  });
}
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement `lib/notifications/notification_settings.dart`**

```dart
import 'notification_event.dart';

class NotificationSettings {
  final Map<NotificationTrigger, bool> _enabled;
  const NotificationSettings(this._enabled);

  const NotificationSettings.allOn() : _enabled = const {};

  bool isEnabled(NotificationTrigger t) => _enabled[t] ?? true;

  NotificationSettings withTrigger(NotificationTrigger t, bool value) {
    final next = {
      for (final x in NotificationTrigger.values) x: isEnabled(x),
    };
    next[t] = value;
    return NotificationSettings(next);
  }
}
```

- [ ] **Step 4: Run, verify PASS (2 tests)**

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/notifications/notification_settings.dart test/notifications/notification_settings_test.dart && git commit -m "feat: NotificationSettings per-trigger toggles"
```

---

## Task 3: Settings + History stores (shared_preferences)

**Files:**
- Create: `lib/notifications/notification_settings_store.dart`
- Create: `lib/notifications/notification_history_store.dart`
- Test: `test/notifications/notification_stores_test.dart`

- [ ] **Step 1: Write the failing test**

`test/notifications/notification_stores_test.dart`:
```dart
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/notifications/notification_event.dart';
import 'package:pt_mobile/notifications/notification_history_store.dart';
import 'package:pt_mobile/notifications/notification_settings_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('settings store persists a toggle', () async {
    final prefs = await SharedPreferences.getInstance();
    final store = NotificationSettingsStore(prefs);
    expect(store.load().isEnabled(NotificationTrigger.idle), isTrue);

    await store.setTrigger(NotificationTrigger.idle, false);
    expect(NotificationSettingsStore(prefs).load().isEnabled(NotificationTrigger.idle), isFalse);
  });

  test('history store prepends newest-first and clears', () async {
    final prefs = await SharedPreferences.getInstance();
    final store = NotificationHistoryStore(prefs);
    expect(store.all(), isEmpty);

    await store.add(NotificationEvent(trigger: NotificationTrigger.idle, title: 'a', body: 'b', at: DateTime.parse('2026-06-01T00:00:00Z')));
    await store.add(NotificationEvent(trigger: NotificationTrigger.newIssue, title: 'c', body: 'd', at: DateTime.parse('2026-06-02T00:00:00Z')));

    final all = NotificationHistoryStore(prefs).all();
    expect(all.length, 2);
    expect(all.first.title, 'c'); // newest first

    await store.clear();
    expect(NotificationHistoryStore(prefs).all(), isEmpty);
  });
}
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement `lib/notifications/notification_settings_store.dart`**

```dart
import 'package:shared_preferences/shared_preferences.dart';
import 'notification_event.dart';
import 'notification_settings.dart';

class NotificationSettingsStore {
  final SharedPreferences _prefs;
  NotificationSettingsStore(this._prefs);

  String _key(NotificationTrigger t) => 'notif_enabled_${t.name}';

  NotificationSettings load() {
    final map = {
      for (final t in NotificationTrigger.values) t: _prefs.getBool(_key(t)) ?? true,
    };
    return NotificationSettings(map);
  }

  Future<void> setTrigger(NotificationTrigger t, bool value) =>
      _prefs.setBool(_key(t), value);
}
```

- [ ] **Step 4: Implement `lib/notifications/notification_history_store.dart`**

```dart
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'notification_event.dart';

class NotificationHistoryStore {
  static const _key = 'notif_history';
  static const _cap = 50;

  final SharedPreferences _prefs;
  NotificationHistoryStore(this._prefs);

  List<NotificationEvent> all() {
    final raw = _prefs.getStringList(_key) ?? const [];
    return raw
        .map((s) => NotificationEvent.fromJson(jsonDecode(s) as Map<String, dynamic>))
        .toList();
  }

  Future<void> add(NotificationEvent event) async {
    final current = _prefs.getStringList(_key) ?? <String>[];
    current.insert(0, jsonEncode(event.toJson())); // newest first
    if (current.length > _cap) current.removeRange(_cap, current.length);
    await _prefs.setStringList(_key, current);
  }

  Future<void> clear() => _prefs.remove(_key);
}
```

- [ ] **Step 5: Run, verify PASS (2 tests)**

- [ ] **Step 6: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/notifications/notification_settings_store.dart lib/notifications/notification_history_store.dart test/notifications/notification_stores_test.dart && git commit -m "feat: notification settings and history stores"
```

---

## Task 4: NotificationRules (6종 순수 판정)

**Files:**
- Create: `lib/notifications/notification_rules.dart`
- Test: `test/notifications/notification_rules_test.dart`

- [ ] **Step 1: Write the failing test**

`test/notifications/notification_rules_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/models/project.dart';
import 'package:pt_mobile/models/scan_result.dart';
import 'package:pt_mobile/notifications/notification_event.dart';
import 'package:pt_mobile/notifications/notification_rules.dart';
import 'package:pt_mobile/notifications/notification_settings.dart';

final _now = DateTime.parse('2026-06-03T09:00:00Z');

Project p({
  String id = 'a',
  String name = 'a',
  int progress = 0,
  int days = 0,
  int weekCommits = 0,
  List<String> issues = const [],
}) =>
    Project(
      id: id,
      name: name,
      progress: Progress(percentage: progress),
      activity: Activity(daysSinceLastCommit: days, commitsInLastWeek: weekCommits),
      issues: issues,
    );

Set<NotificationTrigger> triggersOf(List<NotificationEvent> e) =>
    e.map((x) => x.trigger).toSet();

void main() {
  const on = NotificationSettings.allOn();

  test('ninetyComplete fires when a project newly reaches 90', () {
    final latest = ScanResult(projects: [p(progress: 95)]);
    final prev = ScanResult(projects: [p(progress: 80)]);
    final events = NotificationRules.evaluate(latest: latest, previous: prev, settings: on, now: _now);
    expect(triggersOf(events), contains(NotificationTrigger.ninetyComplete));
  });

  test('ninetyComplete does NOT fire if it was already at 90 before', () {
    final latest = ScanResult(projects: [p(progress: 95)]);
    final prev = ScanResult(projects: [p(progress: 92)]);
    final events = NotificationRules.evaluate(latest: latest, previous: prev, settings: on, now: _now);
    expect(triggersOf(events), isNot(contains(NotificationTrigger.ninetyComplete)));
  });

  test('newIssue fires for an issue absent in the previous snapshot', () {
    final latest = ScanResult(projects: [p(issues: ['no readme'])]);
    final prev = ScanResult(projects: [p(issues: const [])]);
    final events = NotificationRules.evaluate(latest: latest, previous: prev, settings: on, now: _now);
    expect(triggersOf(events), contains(NotificationTrigger.newIssue));
  });

  test('idle fires when a project is stalled >= 14 days', () {
    final latest = ScanResult(projects: [p(days: 20)]);
    final events = NotificationRules.evaluate(latest: latest, previous: null, settings: on, now: _now);
    expect(triggersOf(events), contains(NotificationTrigger.idle));
  });

  test('weeklyActive fires when a project has commits this week', () {
    final latest = ScanResult(projects: [p(weekCommits: 5)]);
    final events = NotificationRules.evaluate(latest: latest, previous: null, settings: on, now: _now);
    expect(triggersOf(events), contains(NotificationTrigger.weeklyActive));
  });

  test('todayRecommendation fires when projects exist', () {
    final latest = ScanResult(projects: [p(progress: 50)]);
    final events = NotificationRules.evaluate(latest: latest, previous: null, settings: on, now: _now);
    expect(triggersOf(events), contains(NotificationTrigger.todayRecommendation));
  });

  test('disabled triggers are skipped', () {
    final latest = ScanResult(projects: [p(progress: 95, days: 20, weekCommits: 3)]);
    final settings = const NotificationSettings.allOn()
        .withTrigger(NotificationTrigger.ninetyComplete, false)
        .withTrigger(NotificationTrigger.idle, false)
        .withTrigger(NotificationTrigger.weeklyActive, false)
        .withTrigger(NotificationTrigger.todayRecommendation, false);
    final events = NotificationRules.evaluate(latest: latest, previous: null, settings: settings, now: _now);
    expect(triggersOf(events).contains(NotificationTrigger.ninetyComplete), isFalse);
    expect(triggersOf(events).contains(NotificationTrigger.idle), isFalse);
  });
}
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement `lib/notifications/notification_rules.dart`**

```dart
import '../models/project.dart';
import '../models/scan_result.dart';
import '../recommendations/recommendation_engine.dart';
import '../recommendations/recommendation_weights.dart';
import 'notification_event.dart';
import 'notification_settings.dart';

class NotificationRules {
  NotificationRules._();

  static List<NotificationEvent> evaluate({
    required ScanResult latest,
    required ScanResult? previous,
    required NotificationSettings settings,
    required DateTime now,
  }) {
    final events = <NotificationEvent>[];
    void emit(NotificationTrigger t, String title, String body) {
      if (settings.isEnabled(t)) {
        events.add(NotificationEvent(trigger: t, title: title, body: body, at: now));
      }
    }

    int? prevProgress(String id) {
      final m = previous?.projects.where((p) => p.id == id);
      if (m == null || m.isEmpty) return null;
      return m.first.progress?.percentage ?? 0;
    }

    Set<String> prevIssues(String id) {
      final m = previous?.projects.where((p) => p.id == id);
      if (m == null || m.isEmpty) return const {};
      return m.first.issues.toSet();
    }

    // 1. ninetyComplete: newly reached >= 90
    for (final p in latest.projects) {
      final prog = p.progress?.percentage ?? 0;
      if (prog >= 90) {
        final before = prevProgress(p.id);
        if (before == null || before < 90) {
          emit(NotificationTrigger.ninetyComplete, '🎉 90% 도달', '${p.name}이 $prog% 완료');
        }
      }
    }

    // 2. newIssue: an issue not present previously
    if (previous != null) {
      for (final p in latest.projects) {
        final prior = prevIssues(p.id);
        final fresh = p.issues.where((i) => !prior.contains(i)).toList();
        if (fresh.isNotEmpty) {
          emit(NotificationTrigger.newIssue, '⚠️ 이슈 감지', '${p.name}: ${fresh.first}');
        }
      }
    }

    // 3. idle: stalled >= 14 days
    final idle = latest.projects
        .where((p) => (p.activity?.daysSinceLastCommit ?? 0) >= 14)
        .toList();
    if (idle.isNotEmpty) {
      emit(NotificationTrigger.idle, '💭 멈춘 프로젝트', '${idle.length}개가 2주째 멈춰있어요');
    }

    // 4. weeklyActive: most commits this week (>0)
    final byCommits = [...latest.projects]
      ..sort((a, b) => (b.activity?.commitsInLastWeek ?? 0)
          .compareTo(a.activity?.commitsInLastWeek ?? 0));
    if (byCommits.isNotEmpty && (byCommits.first.activity?.commitsInLastWeek ?? 0) > 0) {
      final top = byCommits.first;
      emit(NotificationTrigger.weeklyActive, '🔥 이번 주 활발',
          '${top.name} (${top.activity?.commitsInLastWeek ?? 0} commits)');
    }

    // 5. weeklyReport: avg progress change vs previous
    if (previous != null) {
      final delta = _avgProgress(latest) - _avgProgress(previous);
      final sign = delta >= 0 ? '+' : '';
      emit(NotificationTrigger.weeklyReport, '📊 주간 리포트',
          '평균 진행률 $sign${delta.toStringAsFixed(0)}');
    }

    // 6. todayRecommendation: top picks
    if (latest.projects.isNotEmpty) {
      final top = RecommendationEngine.recommend(
          latest.projects, RecommendationWeights.defaults,
          limit: 3);
      emit(NotificationTrigger.todayRecommendation, '🎯 오늘의 추천',
          top.map((e) => e.project.name).join(', '));
    }

    return events;
  }

  static double _avgProgress(ScanResult scan) {
    if (scan.projects.isEmpty) return 0;
    final sum = scan.projects.fold<int>(0, (a, p) => a + (p.progress?.percentage ?? 0));
    return sum / scan.projects.length;
  }
}
```

- [ ] **Step 4: Run, verify PASS (7 tests)**

- [ ] **Step 5: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/notifications/notification_rules.dart test/notifications/notification_rules_test.dart && git commit -m "feat: NotificationRules — 6 on-device trigger rules"
```

---

## Task 5: LocalNotifier 시임 + NotificationService + providers

**Files:**
- Create: `lib/notifications/local_notifier.dart`
- Create: `lib/notifications/notification_service.dart`
- Create: `lib/notifications/notification_providers.dart`
- Test: `test/notifications/notification_service_test.dart`

- [ ] **Step 1: Write the failing test**

`test/notifications/notification_service_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/models/project.dart';
import 'package:pt_mobile/models/scan_result.dart';
import 'package:pt_mobile/notifications/local_notifier.dart';
import 'package:pt_mobile/notifications/notification_event.dart';
import 'package:pt_mobile/notifications/notification_history_store.dart';
import 'package:pt_mobile/notifications/notification_service.dart';
import 'package:pt_mobile/notifications/notification_settings_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

class FakeNotifier implements LocalNotifier {
  final shown = <NotificationEvent>[];
  @override
  Future<void> show(NotificationEvent event) async => shown.add(event);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('evaluateAndRecord records events to history and notifies', () async {
    final prefs = await SharedPreferences.getInstance();
    final fake = FakeNotifier();
    final service = NotificationService(
      settingsStore: NotificationSettingsStore(prefs),
      historyStore: NotificationHistoryStore(prefs),
      notifier: fake,
    );
    final latest = ScanResult(projects: [
      Project(id: 'a', name: 'a', progress: Progress(percentage: 95), activity: Activity(daysSinceLastCommit: 20)),
    ]);

    final events = await service.evaluateAndRecord(latest: latest, previous: null, now: DateTime.parse('2026-06-03T09:00:00Z'));

    expect(events, isNotEmpty);
    expect(fake.shown.length, events.length);
    expect(NotificationHistoryStore(prefs).all().length, events.length);
  });

  test('respects disabled triggers via settings store', () async {
    final prefs = await SharedPreferences.getInstance();
    final settingsStore = NotificationSettingsStore(prefs);
    await settingsStore.setTrigger(NotificationTrigger.todayRecommendation, false);
    await settingsStore.setTrigger(NotificationTrigger.idle, false);
    await settingsStore.setTrigger(NotificationTrigger.ninetyComplete, false);
    await settingsStore.setTrigger(NotificationTrigger.weeklyActive, false);

    final fake = FakeNotifier();
    final service = NotificationService(
      settingsStore: settingsStore,
      historyStore: NotificationHistoryStore(prefs),
      notifier: fake,
    );
    final latest = ScanResult(projects: [
      Project(id: 'a', name: 'a', progress: Progress(percentage: 95), activity: Activity(daysSinceLastCommit: 20)),
    ]);
    final events = await service.evaluateAndRecord(latest: latest, previous: null, now: DateTime.now());
    expect(events, isEmpty);
  });
}
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement `lib/notifications/local_notifier.dart`**

```dart
import 'notification_event.dart';

/// Seam for OS-level local notification delivery. The default [NoopLocalNotifier]
/// records nothing extra (history is handled by the service); a real
/// flutter_local_notifications-backed implementation is a documented follow-up.
abstract class LocalNotifier {
  Future<void> show(NotificationEvent event);
}

class NoopLocalNotifier implements LocalNotifier {
  const NoopLocalNotifier();
  @override
  Future<void> show(NotificationEvent event) async {}
}
```

- [ ] **Step 4: Implement `lib/notifications/notification_service.dart`**

```dart
import '../models/scan_result.dart';
import 'local_notifier.dart';
import 'notification_event.dart';
import 'notification_history_store.dart';
import 'notification_rules.dart';
import 'notification_settings_store.dart';

class NotificationService {
  final NotificationSettingsStore settingsStore;
  final NotificationHistoryStore historyStore;
  final LocalNotifier notifier;

  NotificationService({
    required this.settingsStore,
    required this.historyStore,
    required this.notifier,
  });

  Future<List<NotificationEvent>> evaluateAndRecord({
    required ScanResult latest,
    required ScanResult? previous,
    required DateTime now,
  }) async {
    final events = NotificationRules.evaluate(
      latest: latest,
      previous: previous,
      settings: settingsStore.load(),
      now: now,
    );
    for (final e in events) {
      await historyStore.add(e);
      await notifier.show(e);
    }
    return events;
  }
}
```

- [ ] **Step 5: Implement `lib/notifications/notification_providers.dart`**

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'local_notifier.dart';
import 'notification_history_store.dart';
import 'notification_service.dart';
import 'notification_settings_store.dart';

/// Overridden at app start / tests with prefs-backed stores.
final notificationSettingsStoreProvider =
    Provider<NotificationSettingsStore>((ref) {
  throw UnimplementedError('override notificationSettingsStoreProvider');
});
final notificationHistoryStoreProvider =
    Provider<NotificationHistoryStore>((ref) {
  throw UnimplementedError('override notificationHistoryStoreProvider');
});
final localNotifierProvider =
    Provider<LocalNotifier>((ref) => const NoopLocalNotifier());

final notificationServiceProvider = Provider<NotificationService>((ref) {
  return NotificationService(
    settingsStore: ref.watch(notificationSettingsStoreProvider),
    historyStore: ref.watch(notificationHistoryStoreProvider),
    notifier: ref.watch(localNotifierProvider),
  );
});
```

- [ ] **Step 6: Run, verify PASS (2 tests)**

- [ ] **Step 7: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/notifications/local_notifier.dart lib/notifications/notification_service.dart lib/notifications/notification_providers.dart test/notifications/notification_service_test.dart && git commit -m "feat: NotificationService, LocalNotifier seam and providers"
```

---

## Task 6: NotificationsScreen + 탭 + 앱 초기화

**Files:**
- Create: `lib/notifications/notifications_screen.dart`
- Modify: `lib/shell/home_shell.dart`
- Modify: `lib/main.dart`
- Modify: `test/shell/home_shell_test.dart`
- Test: `test/notifications/notifications_screen_test.dart`

- [ ] **Step 1: Write the failing screen test**

`test/notifications/notifications_screen_test.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/data/database_connection.dart';
import 'package:pt_mobile/data/snapshot_database.dart';
import 'package:pt_mobile/providers.dart';
import 'package:pt_mobile/notifications/notification_history_store.dart';
import 'package:pt_mobile/notifications/notification_providers.dart';
import 'package:pt_mobile/notifications/notification_settings_store.dart';
import 'package:pt_mobile/notifications/notifications_screen.dart';
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
      notificationSettingsStoreProvider.overrideWithValue(NotificationSettingsStore(prefs)),
      notificationHistoryStoreProvider.overrideWithValue(NotificationHistoryStore(prefs)),
    ]);
  }

  Widget host(ProviderContainer c) => UncontrolledProviderScope(
        container: c,
        child: const MaterialApp(home: NotificationsScreen()),
      );

  testWidgets('shows settings toggles and empty history', (tester) async {
    final c = await container();
    addTearDown(c.dispose);
    await tester.pumpWidget(host(c));
    await tester.pumpAndSettle();
    expect(find.text('알림 설정'), findsOneWidget);
    expect(find.byType(SwitchListTile), findsWidgets);
    expect(find.textContaining('알림 없음'), findsOneWidget);
  });

  testWidgets('"지금 평가" records history from latest snapshot', (tester) async {
    final c = await container();
    addTearDown(c.dispose);
    await c.read(repositoryProvider).saveSnapshot('{"projects":[{"id":"a","name":"a","progress":{"percentage":95},"activity":{"daysSinceLastCommit":20}}]}');
    await tester.pumpWidget(host(c));
    await tester.pumpAndSettle();

    await tester.tap(find.text('지금 평가'));
    await tester.pumpAndSettle();

    expect(NotificationHistoryStore(await SharedPreferences.getInstance()).all(), isNotEmpty);
    expect(find.byType(ListTile), findsWidgets);
  });
}
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement `lib/notifications/notifications_screen.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers.dart';
import 'notification_event.dart';
import 'notification_providers.dart';

final _labels = {
  NotificationTrigger.todayRecommendation: '오늘의 추천',
  NotificationTrigger.weeklyReport: '주간 리포트',
  NotificationTrigger.idle: '무활동 알림',
  NotificationTrigger.ninetyComplete: '90% 도달',
  NotificationTrigger.weeklyActive: '주간 활발',
  NotificationTrigger.newIssue: '새 이슈',
};

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});
  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  Future<void> _evaluateNow() async {
    final history = await ref.read(repositoryProvider).history();
    if (history.isEmpty) return;
    final latest = history.first;
    final previous = history.length > 1 ? history[1] : null;
    await ref.read(notificationServiceProvider).evaluateAndRecord(
          latest: latest,
          previous: previous,
          now: DateTime.now(),
        );
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final settingsStore = ref.watch(notificationSettingsStoreProvider);
    final historyStore = ref.watch(notificationHistoryStoreProvider);
    final settings = settingsStore.load();
    final history = historyStore.all();

    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _evaluateNow,
        icon: const Icon(Icons.notifications_active),
        label: const Text('지금 평가'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('알림 설정', style: Theme.of(context).textTheme.titleLarge),
          for (final t in NotificationTrigger.values)
            SwitchListTile(
              dense: true,
              title: Text(_labels[t]!),
              value: settings.isEnabled(t),
              onChanged: (v) async {
                await settingsStore.setTrigger(t, v);
                setState(() {});
              },
            ),
          const Divider(height: 32),
          Text('알림 히스토리', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          if (history.isEmpty)
            const Text('알림 없음')
          else
            for (final e in history)
              ListTile(
                dense: true,
                title: Text(e.title),
                subtitle: Text(e.body),
              ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 4: Run, verify PASS (2 tests)**

- [ ] **Step 5: Add the Notifications tab to `home_shell.dart`**

Add import `import '../notifications/notifications_screen.dart';`, append `NotificationsScreen()` to `_screens`, and add destination:
```dart
          NavigationDestination(icon: Icon(Icons.notifications), label: 'Alerts'),
```

- [ ] **Step 6: Wire stores in `main.dart`**

Add to `main()`'s `ProviderScope.overrides` (keep the existing interactionStore override):
```dart
import 'notifications/notification_history_store.dart';
import 'notifications/notification_providers.dart';
import 'notifications/notification_settings_store.dart';
```
```dart
      notificationSettingsStoreProvider.overrideWithValue(NotificationSettingsStore(prefs)),
      notificationHistoryStoreProvider.overrideWithValue(NotificationHistoryStore(prefs)),
```

- [ ] **Step 7: Update `home_shell_test.dart` for the 5th tab**

Add `import 'package:pt_mobile/notifications/notifications_screen.dart';` and provider/store imports, and a test. Because tapping 'Alerts' mounts `NotificationsScreen` which reads `notificationSettingsStoreProvider`/`notificationHistoryStoreProvider`, the HomeShell test container for THIS test must also override those two (and keep `interactionStoreProvider`). Append:
```dart
  testWidgets('switches to Notifications tab', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final c = ProviderContainer(overrides: [
      databaseProvider.overrideWith((ref) {
        final db = SnapshotDatabase(openConnection(inMemory: true));
        ref.onDispose(db.close);
        return db;
      }),
      interactionStoreProvider.overrideWithValue(InteractionStore(prefs)),
      notificationSettingsStoreProvider.overrideWithValue(NotificationSettingsStore(prefs)),
      notificationHistoryStoreProvider.overrideWithValue(NotificationHistoryStore(prefs)),
    ]);
    addTearDown(c.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: c,
      child: const MaterialApp(home: HomeShell()),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.notifications));
    await tester.pumpAndSettle();
    expect(find.byType(NotificationsScreen), findsOneWidget);
  });
```
with imports:
```dart
import 'package:pt_mobile/notifications/notification_history_store.dart';
import 'package:pt_mobile/notifications/notification_providers.dart';
import 'package:pt_mobile/notifications/notification_settings_store.dart';
import 'package:pt_mobile/notifications/notifications_screen.dart';
```

- [ ] **Step 8: Run full suite + analyze**

Run: `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test ; echo test_exit=$? ; flutter analyze ; echo analyze_exit=$?`
Expected: all tests PASS, `No issues found!`.

- [ ] **Step 9: Commit + push**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add -A && git commit -m "feat: Notifications screen with triggers, history and settings; final tab" && git push origin main
```

---

## Self-Review 메모

- **스펙 §5.5/§6 커버리지:** 6종 트리거(오늘의 추천/주간 리포트/무활동/90% 도달/주간 활발/새 이슈, Task 4) / 알림 히스토리(Task 3·6) / 트리거 on/off 설정(Task 2·3·6) / 탭 추가(Task 6) 모두 태스크 존재. OS 스케줄 시간대(09:00 등)는 데이터 기반 판정 + best-effort 전달로 단순화(LocalNotifier 시임).
- **타입 일관성:** `NotificationTrigger`(6), `NotificationEvent{trigger,title,body,at}+toJson/fromJson`, `NotificationSettings{isEnabled,withTrigger,allOn}`, `NotificationSettingsStore{load,setTrigger}`, `NotificationHistoryStore{all,add,clear}`, `NotificationRules.evaluate`, `LocalNotifier.show`/`NoopLocalNotifier`, `NotificationService.evaluateAndRecord`, providers(`notificationSettingsStoreProvider`,`notificationHistoryStoreProvider`,`localNotifierProvider`,`notificationServiceProvider`) 전 태스크 일관.
- **의도된 결정:** 실제 flutter_local_notifications 전달은 `LocalNotifier` 시임 + Noop 기본으로 분리(무기기 검증 불가). 트리거/히스토리/설정이 전달·검증 핵심.
- **재사용:** `RecommendationEngine`/`RecommendationWeights`(오늘의 추천), `SnapshotRepository.history`(직전 스냅샷 비교), shared_preferences.
- **완료:** 이 슬라이스로 스펙 §5의 5개 화면 전부 구현.
```
