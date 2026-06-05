# pt-mobile Local Notification Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `NoopLocalNotifier` with a `flutter_local_notifications`-backed `PluginLocalNotifier` so `notifier.show(event)` raises a real OS local notification, wired in `main`.

**Architecture:** A thin `NotificationApi` interface abstracts the plugin call surface. `PluginLocalNotifier` (testable, fake-injected) owns the gating logic — request permission once on first `show`, assign an incrementing id per notification so they stack. `RealNotificationApi` delegates to the actual plugin and is device-verified only.

**Tech Stack:** Flutter, Dart 3.11.5, Riverpod, `flutter_local_notifications` (immediate `show()` only — no timezone/workmanager).

---

## Environment Note

Flutter/Dart is NOT on PATH. Prefix every flutter/dart command, same line:
`export PATH="$PATH:/Users/jean325/development/flutter/bin" && flutter test`

Always append `; echo exit=$?` so a pipe doesn't mask the exit code. Project root:
`/Users/jean325/portfolio/projects/pt-mobile/`. All paths below are relative to it unless noted.

The portfolio-tracker repo (where this plan lives) is a SEPARATE git repo at
`/Users/jean325/portfolio/portfolio-tracker`. **All app commits/pushes happen in the
pt-mobile repo**, not portfolio-tracker.

## File Structure

```
lib/notifications/
  notification_api.dart        (NEW) — NotificationApi interface + RealNotificationApi adapter
  plugin_local_notifier.dart   (NEW) — PluginLocalNotifier (LocalNotifier impl, gating logic)
lib/main.dart                  (MODIFY) — construct + init + override localNotifierProvider
android/app/src/main/AndroidManifest.xml  (MODIFY) — POST_NOTIFICATIONS permission
pubspec.yaml                   (MODIFY, via `flutter pub add`)
test/notifications/plugin_local_notifier_test.dart  (NEW) — unit tests w/ FakeNotificationApi
```

Untouched: `local_notifier.dart`, `notification_service.dart`, `notification_rules.dart`,
`notification_event.dart`, `notification_providers.dart`, all existing tests.

---

### Task 1: Add the flutter_local_notifications dependency

**Files:**
- Modify: `pubspec.yaml` (via command)

- [ ] **Step 1: Add the package**

Run:
```bash
export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter pub add flutter_local_notifications ; echo exit=$?
```
Expected: resolves and writes a `flutter_local_notifications:` line under `dependencies`
in `pubspec.yaml`, exit=0. (Pin is whatever `pub add` selects for Dart 3.11.5.)

- [ ] **Step 2: Verify the existing suite still passes (plugin unused so far)**

Run:
```bash
export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter analyze ; echo exit=$? && flutter test ; echo exit=$?
```
Expected: analyze "No issues found!", all tests pass, both exit=0.

- [ ] **Step 3: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add pubspec.yaml pubspec.lock && git commit -m "chore: add flutter_local_notifications dependency

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Define the NotificationApi interface

This is a pure abstract interface (no behavior) so it has no standalone test — its
consumers (`PluginLocalNotifier`, `RealNotificationApi`, `FakeNotificationApi`) are
tested/verified in later tasks. Create it first so later code compiles.

**Files:**
- Create: `lib/notifications/notification_api.dart`

- [ ] **Step 1: Create the interface (adapter added in Task 4)**

Create `lib/notifications/notification_api.dart`:
```dart
/// Minimal call surface over the OS notification plugin. Abstracted so the
/// gating logic in [PluginLocalNotifier] can be unit-tested with a fake, while
/// the real plugin delegate ([RealNotificationApi], added later) is verified
/// only on a device.
abstract class NotificationApi {
  /// Initialize the plugin and create the Android channel. Does NOT request
  /// permission.
  Future<void> init();

  /// Request OS notification permission. Returns whether it was granted
  /// (null/false when unknown or denied).
  Future<bool?> ensurePermission();

  /// Show an OS notification immediately.
  Future<void> show(int id, String title, String body);
}
```

- [ ] **Step 2: Verify analyze is clean**

Run:
```bash
export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter analyze ; echo exit=$?
```
Expected: "No issues found!", exit=0.

- [ ] **Step 3: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/notifications/notification_api.dart && git commit -m "feat: add NotificationApi seam interface

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: PluginLocalNotifier gating logic (TDD)

**Files:**
- Create: `test/notifications/plugin_local_notifier_test.dart`
- Create: `lib/notifications/plugin_local_notifier.dart`

- [ ] **Step 1: Write the failing tests**

Create `test/notifications/plugin_local_notifier_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/notifications/notification_api.dart';
import 'package:pt_mobile/notifications/notification_event.dart';
import 'package:pt_mobile/notifications/plugin_local_notifier.dart';

class FakeNotificationApi implements NotificationApi {
  int initCalls = 0;
  int permissionCalls = 0;
  final shown = <(int, String, String)>[];

  @override
  Future<void> init() async => initCalls++;

  @override
  Future<bool?> ensurePermission() async {
    permissionCalls++;
    return true;
  }

  @override
  Future<void> show(int id, String title, String body) async =>
      shown.add((id, title, body));
}

NotificationEvent _event(String title, String body) => NotificationEvent(
      trigger: NotificationTrigger.weeklyReport,
      title: title,
      body: body,
      at: DateTime.parse('2026-06-05T09:00:00Z'),
    );

void main() {
  test('init delegates to the api', () async {
    final api = FakeNotificationApi();
    await PluginLocalNotifier(api).init();
    expect(api.initCalls, 1);
  });

  test('requests permission exactly once across multiple shows', () async {
    final api = FakeNotificationApi();
    final notifier = PluginLocalNotifier(api);
    await notifier.show(_event('a', 'b'));
    await notifier.show(_event('c', 'd'));
    await notifier.show(_event('e', 'f'));
    expect(api.permissionCalls, 1);
    expect(api.shown.length, 3);
  });

  test('assigns an incrementing id per show so notifications stack', () async {
    final api = FakeNotificationApi();
    final notifier = PluginLocalNotifier(api);
    await notifier.show(_event('a', 'b'));
    await notifier.show(_event('c', 'd'));
    expect(api.shown.map((e) => e.$1).toList(), [0, 1]);
  });

  test('forwards the event title and body verbatim', () async {
    final api = FakeNotificationApi();
    final notifier = PluginLocalNotifier(api);
    await notifier.show(_event('오늘의 추천', '프로젝트 a를 진행하세요'));
    expect(api.shown.single.$2, '오늘의 추천');
    expect(api.shown.single.$3, '프로젝트 a를 진행하세요');
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/notifications/plugin_local_notifier_test.dart ; echo exit=$?
```
Expected: FAIL — `plugin_local_notifier.dart` / `PluginLocalNotifier` not found (compile error).

- [ ] **Step 3: Write the minimal implementation**

Create `lib/notifications/plugin_local_notifier.dart`:
```dart
import 'local_notifier.dart';
import 'notification_api.dart';
import 'notification_event.dart';

/// Real [LocalNotifier] backed by a [NotificationApi]. Owns the gating logic:
/// request OS permission once on first show, then assign an incrementing id per
/// notification so they stack instead of overwriting.
class PluginLocalNotifier implements LocalNotifier {
  PluginLocalNotifier(this._api);

  final NotificationApi _api;
  bool _permissionRequested = false;
  int _nextId = 0;

  /// Call once at app start (delegates to the api). Does not request permission.
  Future<void> init() => _api.init();

  @override
  Future<void> show(NotificationEvent event) async {
    if (!_permissionRequested) {
      _permissionRequested = true;
      await _api.ensurePermission();
    }
    await _api.show(_nextId++, event.title, event.body);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/notifications/plugin_local_notifier_test.dart ; echo exit=$?
```
Expected: all 4 tests PASS, exit=0.

- [ ] **Step 5: Full suite + analyze**

Run:
```bash
export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter analyze ; echo exit=$? && flutter test ; echo exit=$?
```
Expected: "No issues found!", whole suite green, both exit=0.

- [ ] **Step 6: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/notifications/plugin_local_notifier.dart test/notifications/plugin_local_notifier_test.dart && git commit -m "feat: PluginLocalNotifier with permission-once + stacking ids

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: RealNotificationApi plugin adapter (device-verified glue)

This is thin delegation to `flutter_local_notifications`; it has no automated test
(can't run the plugin in `flutter test`). It must compile and pass `flutter analyze`.

**Files:**
- Modify: `lib/notifications/notification_api.dart` (append the adapter)

- [ ] **Step 1: Append the RealNotificationApi class**

Add to the TOP of `lib/notifications/notification_api.dart` (imports) and the BOTTOM
(class). Imports first:
```dart
import 'dart:io' show Platform;

import 'package:flutter_local_notifications/flutter_local_notifications.dart';
```
Then append after the `NotificationApi` abstract class:
```dart
const _channelId = 'pt_alerts';
const _channelName = 'Portfolio Tracker';

/// Real delegate over [FlutterLocalNotificationsPlugin]. NOT covered by automated
/// tests — verified manually on a device.
class RealNotificationApi implements NotificationApi {
  final _plugin = FlutterLocalNotificationsPlugin();

  @override
  Future<void> init() async {
    await _plugin.initialize(
      const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      ),
    );
    await _plugin
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(
      const AndroidNotificationChannel(
        _channelId,
        _channelName,
        importance: Importance.defaultImportance,
      ),
    );
  }

  @override
  Future<bool?> ensurePermission() async {
    if (Platform.isIOS) {
      return _plugin
          .resolvePlatformSpecificImplementation<
              IOSFlutterLocalNotificationsPlugin>()
          ?.requestPermissions(alert: true, badge: true, sound: true);
    }
    if (Platform.isAndroid) {
      return _plugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.requestNotificationsPermission();
    }
    return null;
  }

  @override
  Future<void> show(int id, String title, String body) {
    return _plugin.show(
      id,
      title,
      body,
      const NotificationDetails(
        android: AndroidNotificationDetails(
          _channelId,
          _channelName,
          importance: Importance.defaultImportance,
          priority: Priority.defaultPriority,
        ),
        iOS: DarwinNotificationDetails(),
      ),
    );
  }
}
```

- [ ] **Step 2: Verify analyze + full suite**

Run:
```bash
export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter analyze ; echo exit=$? && flutter test ; echo exit=$?
```
Expected: "No issues found!", whole suite green (Real adapter is unused by tests), both exit=0.

> If `flutter analyze` flags a renamed method (e.g. `requestNotificationsPermission`),
> check the installed plugin version's API with
> `export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && cat .dart_tool/package_config.json | grep flutter_local`
> then open the package's `flutter_local_notifications_platform_interface` exports and
> adjust the method name. Do not change the gating logic in `PluginLocalNotifier`.

- [ ] **Step 3: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/notifications/notification_api.dart && git commit -m "feat: RealNotificationApi adapter over flutter_local_notifications

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Android native permission

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Add the POST_NOTIFICATIONS permission**

Open `android/app/src/main/AndroidManifest.xml`. Add this line as the first child of
`<manifest ...>`, immediately before the `<application ...>` tag:
```xml
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
```
(The channel is created at runtime in `RealNotificationApi.init()`, so no further
manifest changes are needed. iOS needs no Info.plist key for local notifications.)

- [ ] **Step 2: Verify analyze still clean (no Dart change, sanity only)**

Run:
```bash
export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter analyze ; echo exit=$?
```
Expected: "No issues found!", exit=0.

- [ ] **Step 3: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add android/app/src/main/AndroidManifest.xml && git commit -m "chore(android): add POST_NOTIFICATIONS permission

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wire PluginLocalNotifier into main

**Files:**
- Modify: `lib/main.dart`

- [ ] **Step 1: Construct, init, and override the provider**

In `lib/main.dart`, add imports near the other notification imports:
```dart
import 'notifications/notification_api.dart';
import 'notifications/plugin_local_notifier.dart';
```
In `main()`, after `final prefs = await SharedPreferences.getInstance();` and before
`runApp(...)`, add:
```dart
  final notifier = PluginLocalNotifier(RealNotificationApi());
  await notifier.init();
```
Then add this entry to the existing `overrides:` list (alongside the store overrides):
```dart
      localNotifierProvider.overrideWithValue(notifier),
```
`localNotifierProvider` comes from `notifications/notification_providers.dart`, which is
already imported in `main.dart`.

- [ ] **Step 2: Verify analyze + full suite**

Run:
```bash
export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter analyze ; echo exit=$? && flutter test ; echo exit=$?
```
Expected: "No issues found!", whole suite green, both exit=0. (Widget tests use their own
ProviderScope overrides, so the real notifier in `main` does not affect them.)

- [ ] **Step 3: Commit**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git add lib/main.dart && git commit -m "feat: wire PluginLocalNotifier into main

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Manual device verification + push

No automated coverage exists for actual OS delivery — verify on the connected iOS device.

- [ ] **Step 1: Run on the iOS device**

Run (device id from `flutter devices` — the iOS entry):
```bash
export PATH="$PATH:/Users/jean325/development/flutter/bin" && cd /Users/jean325/portfolio/projects/pt-mobile && flutter run -d 00008120-00012C2C3663C01E ; echo exit=$?
```
> If the device id changed, list devices first:
> `export PATH="$PATH:/Users/jean325/development/flutter/bin" && flutter devices`

- [ ] **Step 2: Exercise the notification path**

In the running app: load a scan-result.json (if not already), go to the Alerts tab, tap
**지금 평가**.
Expected: on first tap an iOS permission dialog appears; after allowing, one or more OS
notification banners appear (one per generated event). Subsequent taps show banners with
no further permission prompt.

> If no events are generated, history may have only one scan or all triggers may be
> disabled. Confirm with the in-app history list / settings switches; this is rules
> behavior, not a backend defect.

- [ ] **Step 3: Push to main**

After verification passes:
```bash
cd /Users/jean325/portfolio/projects/pt-mobile && git push origin main ; echo exit=$?
```
Expected: push succeeds, exit=0.

---

## Notes for the implementer

- Do NOT modify `local_notifier.dart`, `notification_service.dart`, `notification_rules.dart`,
  `notification_event.dart`, or `notification_providers.dart`. Only add the two new files,
  edit `main.dart`, the Android manifest, and `pubspec.yaml`.
- Keep `flutter test` / `flutter analyze` green at the end of every task. Tests only ever
  use `FakeNotificationApi` / `FakeNotifier` — never the real plugin.
- App git operations run in `/Users/jean325/portfolio/projects/pt-mobile` (repo
  `jean202/pt-mobile`), not in the portfolio-tracker repo where this plan lives.
