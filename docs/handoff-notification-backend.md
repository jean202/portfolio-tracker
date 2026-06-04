# Handoff: pt-mobile 실제 알림 백엔드 (다음 세션용 프롬프트)

> 작성일 2026-06-04. pt-mobile Phase 3 후속 작업 중 "실제 로컬 알림 백엔드"는 실기기 검증이 필요해 별도 세션으로 미룸. 아래 프롬프트를 새 세션에 그대로 붙여넣어 시작할 것. (관련 메모리: `project_pt_mobile_app.md`)

---

```
pt-mobile 앱에 "실제 로컬 알림 백엔드"를 구현해줘 (flutter_local_notifications).

## 배경
- 앱: Flutter 앱 `/Users/jean325/portfolio/projects/pt-mobile/` (GitHub `jean202/pt-mobile`, main). portfolio-tracker의 scan-result.json을 보는 뷰어. 5탭(Dashboard/Projects/Recommendations/Trends/Alerts).
- 메모리에 프로젝트 요약 있음: `project_pt_mobile_app.md` (앱 전체 상태/위치/스택).
- 설계·플랜 문서는 portfolio-tracker 레포의 `docs/superpowers/specs|plans/`에 있음. 알림 관련: `2026-06-03-mobile-app-notifications.md`.

## 중요한 dev 환경 노트
- Flutter/Dart가 PATH에 없음. 모든 flutter/dart 명령 앞에 같은 줄에서 붙일 것:
  `export PATH="$PATH:/Users/jean325/development/flutter/bin" && flutter test`
- Dart 3.11.5. 테스트: `flutter test`, 정적분석: `flutter analyze`. 파이프가 종료코드를 가리지 않게 `; echo exit=$?`로 확인.

## 이미 있는 것 (시임은 만들어져 있음 — 구현체만 끼우면 됨)
- `lib/notifications/local_notifier.dart`: `abstract class LocalNotifier { Future<void> show(NotificationEvent event); }` + `NoopLocalNotifier`(현재 기본, OS 전달 안 함).
- `lib/notifications/notification_providers.dart`: `localNotifierProvider`가 `NoopLocalNotifier()`를 기본 제공. (settings/history store provider는 main에서 override됨.)
- `lib/notifications/notification_service.dart`: `evaluateAndRecord`가 이벤트마다 `notifier.show(e)` 호출.
- `lib/notifications/notification_event.dart`: `NotificationEvent{trigger, title, body, at}`, `NotificationTrigger`(6종).
- `lib/notifications/notifications_screen.dart`: "지금 평가" 버튼이 evaluateAndRecord 실행 → 이벤트가 notifier.show로 흐름.
- `lib/main.dart`: async main, `ProviderScope.overrides`에 interactionStore + notification store들을 주입.

## 목표
`NoopLocalNotifier`를 대체할 `PluginLocalNotifier implements LocalNotifier`를 flutter_local_notifications로 구현하고, `localNotifierProvider`를 main에서 이걸로 override. `show(event)`가 실제 OS 로컬 알림을 띄우게.

## 먼저 결정해야 할 것 (브레인스토밍 필요)
- 플랫폼 범위: iOS / Android 둘 다? 우선순위?
- 권한 흐름: 알림 권한 요청을 언제(앱 시작 vs 첫 평가 시)?
- 즉시 표시 vs 예약: "지금 평가" 시 즉시 show만? 아니면 시간대 스케줄(9시 등)/백그라운드 fetch(workmanager)까지?  ← 1차 범위를 좁히는 게 좋음
- 네이티브 설정: Android notification channel, iOS Info.plist 권한, timezone 패키지 필요 여부.

## 제약 / 주의
- 이 머신엔 실기기/시뮬레이터 연결 상태를 확인해야 함. OS 전달 자체는 자동 테스트로 검증 불가 → 단위/위젯 테스트는 `LocalNotifier`를 fake로 주입해서 하고(기존 패턴), 실제 플러그인 호출 경로는 기기에서 수동 확인. 플러그인 추가가 `flutter test`/`analyze`를 깨지 않게(테스트는 fake만 사용) 유지.
- 기존 시임/서비스/순수 트리거 로직(NotificationRules)은 건드리지 말 것 — 구현체 추가 + main 배선만.

## 작업 방식
superpowers 워크플로우로: brainstorming(위 결정들) → spec(docs/superpowers/specs/) → writing-plans → TDD 구현. 각 슬라이스 끝에 flutter test + flutter analyze 클린 확인하고 커밋, 마지막에 main 푸시. 커밋 메시지 끝에:
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

먼저 브레인스토밍부터 시작해줘.
```
