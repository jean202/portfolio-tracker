# pt-mobile 실제 로컬 알림 백엔드 — 설계 (Design)

> 작성일 2026-06-05. pt-mobile Phase 3 후속. `NoopLocalNotifier`를 실제 OS 로컬
> 알림을 띄우는 `flutter_local_notifications` 기반 구현으로 대체한다.
> 관련: `docs/superpowers/plans/2026-06-03-mobile-app-notifications.md`,
> 핸드오프 `docs/handoff-notification-backend.md`, 메모리 `project_pt_mobile_app.md`.

## 배경

앱은 `/Users/jean325/portfolio/projects/pt-mobile/` (GitHub `jean202/pt-mobile`, main).
portfolio-tracker의 scan-result.json 뷰어, 5탭(Dashboard/Projects/Recommendations/Trends/Alerts).

알림 시임은 이미 만들어져 있고 구현체만 끼우면 된다:
- `lib/notifications/local_notifier.dart`: `abstract class LocalNotifier { Future<void> show(NotificationEvent event); }` + `NoopLocalNotifier`(현재 기본, OS 전달 안 함).
- `lib/notifications/notification_providers.dart`: `localNotifierProvider`가 `NoopLocalNotifier()` 기본 제공.
- `lib/notifications/notification_service.dart`: `evaluateAndRecord`가 이벤트마다 `historyStore.add(e)` 후 `notifier.show(e)` 호출.
- `lib/notifications/notification_event.dart`: `NotificationEvent{trigger, title, body, at}`, `NotificationTrigger`(6종).
- `lib/notifications/notifications_screen.dart`: "지금 평가" 버튼 → `evaluateAndRecord` → 이벤트가 `notifier.show`로 흐름.
- `lib/main.dart`: async main, `ProviderScope.overrides`에 interactionStore + notification store들 주입.

## 결정 사항 (브레인스토밍 결과)

| 항목 | 결정 |
| --- | --- |
| 전달 범위 | **즉시 표시만**. `show()` → OS 알림 즉시 발행. 시간대 스케줄/백그라운드 fetch 없음 → timezone·workmanager **불필요**. |
| 플랫폼 | **iOS + Android 네이티브 설정 둘 다**. 검증은 연결된 iOS 실기기에서 수동. |
| 권한 시점 | **첫 '지금 평가' 시** (`show` 첫 호출에서 1회 요청). 앱 시작 시 요청 안 함. |
| 구조 | **테스트 가능 어댑터 시임**. `PluginLocalNotifier`가 `NotificationApi` 인터페이스에 의존, 게이팅 로직은 fake로 단위 테스트. |
| 알림 id | **매 이벤트마다 증가하는 id** → 알림이 스택처럼 누적(덮어쓰지 않음). |

## 범위 & 의존성

- 추가 의존성: `flutter_local_notifications` **1개만**. Dart 3.11.5 / 현재 Flutter SDK 호환 최신 버전을 플랜 단계에서 `flutter pub add` 결과로 확정한다.
- `timezone`, `workmanager` 등 **추가하지 않는다** (즉시 표시 범위이므로).
- 코드는 플랫폼 무관. 네이티브 설정만 iOS/Android 각각.

## 컴포넌트 구조

새 파일 2개 + main 배선. 기존 시임/서비스/순수 트리거 로직(`NotificationRules`)은 **건드리지 않는다**.

```
lib/notifications/
  notification_api.dart        (NEW) — 얇은 시임 인터페이스 + 실제 어댑터
  plugin_local_notifier.dart   (NEW) — 게이팅 로직 (테스트 대상)
```

### `notification_api.dart`

플러그인 호출 표면을 최소 인터페이스로 추상화한다. 이렇게 하면 `PluginLocalNotifier`의
로직(권한 1회 요청, id 생성)을 기기 없이 fake로 단위 테스트할 수 있다.

```dart
abstract class NotificationApi {
  /// 플러그인 초기화 + Android 채널 생성. 권한 요청은 하지 않는다.
  Future<void> init();

  /// OS 알림 권한을 요청하고 허용 여부를 반환한다.
  Future<bool> ensurePermission();

  /// 즉시 OS 알림을 발행한다.
  Future<void> show(int id, String title, String body);
}

/// 실제 flutter_local_notifications 위임 어댑터.
/// 자동 테스트 대상 아님 — iOS 실기기에서 수동 검증.
class RealNotificationApi implements NotificationApi { /* ... */ }
```

`RealNotificationApi` 세부:
- `init()`: `FlutterLocalNotificationsPlugin.initialize(...)` 호출.
  - Android: `AndroidInitializationSettings('@mipmap/ic_launcher')`.
  - iOS(Darwin): `DarwinInitializationSettings(requestAlertPermission: false, requestBadgePermission: false, requestSoundPermission: false)` — 시작 시 권한 프롬프트 방지.
  - 초기화 후 Android 채널(`pt_alerts`, 이름 "Portfolio Tracker", 기본 중요도) 생성.
- `ensurePermission()`:
  - iOS: `resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>()?.requestPermissions(alert: true, badge: true, sound: true)`.
  - Android(13+): `resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()?.requestNotificationsPermission()`.
  - 둘 중 현재 플랫폼 해당 호출 결과(bool?)를 반환.
- `show(id, title, body)`: `plugin.show(id, title, body, NotificationDetails(android: AndroidNotificationDetails('pt_alerts', 'Portfolio Tracker'), iOS: DarwinNotificationDetails()))`.

### `plugin_local_notifier.dart`

```dart
class PluginLocalNotifier implements LocalNotifier {
  PluginLocalNotifier(this._api);
  final NotificationApi _api;
  bool _permissionRequested = false;
  int _nextId = 0;

  /// main에서 1회 호출. 내부적으로 _api.init() 위임.
  Future<void> init() => _api.init();

  @override
  Future<void> show(NotificationEvent event) async {
    if (!_permissionRequested) {            // 권한은 첫 show에서 1회만
      _permissionRequested = true;
      await _api.ensurePermission();
    }
    await _api.show(_nextId++, event.title, event.body);  // 매번 새 id → 스택 누적
  }
}
```

`PluginLocalNotifier`는 `LocalNotifier`를 implements 하므로 기존 시임/서비스와 그대로 호환.

## 데이터 흐름

```
첫 '지금 평가' 클릭
  → NotificationService.evaluateAndRecord
    → 이벤트마다: historyStore.add(e)  (기존)
                  notifier.show(e)     (= PluginLocalNotifier.show)
      → 첫 호출: _api.ensurePermission()  → OS 권한 다이얼로그
      → _api.show(id, title, body)         → OS 알림 발행
  이후 호출: 권한 재요청 없이 바로 show, id 계속 증가
```

## 네이티브 설정

- **Android** (`android/app/src/main/AndroidManifest.xml`):
  - `<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>` 추가.
  - 채널은 런타임에 `init()`에서 생성(`pt_alerts` / "Portfolio Tracker" / 기본 중요도).
  - 아이콘 `@mipmap/ic_launcher` (기본 존재).
- **iOS**:
  - 로컬 알림은 별도 Info.plist 키 불필요. 권한은 런타임 `requestPermissions`로 처리.
  - `init()`에서 Darwin 설정의 request* 플래그를 false로 두어 시작 시 프롬프트 방지.

## main 배선

```dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  final notifier = PluginLocalNotifier(RealNotificationApi());
  await notifier.init();
  runApp(ProviderScope(
    overrides: [
      // 기존 override들 유지 ...
      localNotifierProvider.overrideWithValue(notifier),
    ],
    child: const PtMobileApp(),
  ));
}
```

## 테스트 전략

- **단위 테스트** `test/notifications/plugin_local_notifier_test.dart` — `FakeNotificationApi`(호출 기록) 주입:
  1. 첫 `show`에서 `ensurePermission`이 정확히 1회 호출된다.
  2. 이벤트 N개를 show 하면 `ensurePermission`은 여전히 1회, `_api.show`는 N회.
  3. 연속 show의 id가 매번 증가(0,1,2,...)하여 중복이 없다.
  4. 전달된 title/body가 이벤트의 값과 정확히 일치한다.
  5. `init()`이 `_api.init()`을 위임 호출한다.
- 기존 서비스/위젯 테스트는 그대로 (fake `LocalNotifier` 주입). 플러그인 추가가
  `flutter test`/`flutter analyze`를 깨지 않아야 한다 (테스트는 fake만 사용).
- **`RealNotificationApi`는 자동 테스트 대상 아님** → iOS 실기기에서 '지금 평가' 클릭 시
  권한 다이얼로그 + 알림 배너가 뜨는지 수동 검증.

## 검증 (Verification)

각 슬라이스 끝:
- `export PATH="$PATH:/Users/jean325/development/flutter/bin" && flutter test ; echo exit=$?`
- `export PATH="$PATH:/Users/jean325/development/flutter/bin" && flutter analyze ; echo exit=$?`
- 둘 다 클린 확인 후 커밋.

최종:
- iOS 실기기 빌드/실행 → '지금 평가' → 권한 허용 → OS 알림 표시 수동 확인.
- main 푸시.

## 비목표 (Out of Scope)

- 시간대 예약 알림(zonedSchedule), 백그라운드 fetch(workmanager).
- 알림 탭 시 특정 화면 딥링크(기본 앱 열기로 충분).
- Android 실기기 검증(설정은 하되 이번 검증은 iOS만).
- 기존 `NotificationRules`/트리거 로직 변경.
