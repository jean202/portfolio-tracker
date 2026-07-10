# 카카오톡 메시지 → pt-mobile 딥링크 설계

- 날짜: 2026-07-10
- 상태: 설계 승인됨
- 관련 저장소: portfolio-tracker(발신), pt-mobile(수신, `/Users/jean325/portfolio/projects/pt-mobile`)

## 배경 / 문제

portfolio-tracker는 카카오톡 "나에게 보내기"(`/v2/api/talk/memo/default/send`)로 스캔 요약·오늘의 추천 메시지를 보낸다. 현재 텍스트 템플릿의 `link.web_url`이 기본값(developers.kakao.com)이라 메시지를 탭해도 의미 있는 곳으로 연결되지 않는다. 목표: **메시지를 탭하면 pt-mobile 앱이 메시지 종류에 맞는 화면으로 열린다.**

## 환경 제약 (설계를 결정한 조건)

- pt-mobile은 iPhone에 **Xcode 개인 서명으로 설치**된 개인용 앱. App Store 미배포.
- 무료 개인 팀이므로 Associated Domains(Universal Links) 사용 불가 → 커스텀 URL scheme만 가능.
- 카카오 메시지 `link`는 http(s) `web_url` 외에 `ios_execution_params` / `android_execution_params`를 지원하며, 이 경우 카카오톡이 `kakao{네이티브앱키}://kakaolink?<params>` 로 앱 실행을 시도한다.
- pt-mobile은 백엔드 없음(scan-result.json 로컬 조회) → 웹 폴백 페이지에 실데이터를 띄울 수 없음.

## 선택한 접근: execution_params 방식

검토한 대안:
- **A. execution_params (채택)** — 카카오 콘솔에 iOS 플랫폼 등록 + 앱에 `kakao{네이티브앱키}` scheme 등록. 탭 한 번에 앱 직행. 호스팅 불필요.
- B. 브릿지 웹페이지 (GitHub Pages에서 `ptmobile://` 리다이렉트) — 카카오 콘솔 설정 최소화 대신 인앱 브라우저 경유(탭 2번), iOS의 자동 scheme 리다이렉트 차단 리스크, 퍼블릭 호스팅 관리 부담. **A 실패 시 후퇴 경로.**
- C. linkUrl만 정리 — 앱 연결이 안 되므로 목표 미충족. 탈락.

## 1. 파라미터 규약

- 카카오톡이 조립하는 실행 URL: `kakao{네이티브앱키}://kakaolink?screen=<값>`
- portfolio-tracker가 넣는 execution_params 문자열: `screen=dashboard` 또는 `screen=recommendations`
- screen 값 매핑:

| 메시지 종류 | 발신 지점 | screen |
|---|---|---|
| 스캔 요약 | `KakaoNotifier.sendPortfolioSummary` | `dashboard` |
| 오늘의 추천 | `scripts/kakao-briefing.mjs` | `recommendations` |
| 테스트 메시지 | `kakao test` CLI | (파라미터 없음) |

- 수신 측 규칙: screen 미지정·미지원 값·파싱 실패 → **조용히 대시보드로**. 에러 UI 없음.
- key=value 쿼리 형식을 유지해 추후 `project=<id>` 등 확장 가능.

## 2. portfolio-tracker 변경

- `KakaoNotifier.sendTextToMe(text: string, options?: { screen?: string })`로 확장.
  - `screen`이 있으면 template `link`에 `ios_execution_params: "screen=<값>"` 및 동일 값의 `android_execution_params` 추가(미래 Android 대비, 비용 없음).
  - `web_url` / `mobile_web_url` 폴백은 기존대로 유지.
- `sendPortfolioSummary` → `{ screen: "dashboard" }` 전달.
- `scripts/kakao-briefing.mjs` → `{ screen: "recommendations" }` 전달.
- config 스키마·CLI 변경 없음 (전송은 기존 REST 경로 그대로).

## 3. pt-mobile 변경

- `ios/Runner/Info.plist`의 `CFBundleURLTypes`에 `kakao{네이티브앱키}` scheme 등록.
- `app_links` 패키지 추가. cold start(`getInitialLink`)와 실행 중(`uriLinkStream`) 링크 모두 처리.
- 딥링크 파서는 **순수 함수**로 분리: `Uri → 대상 화면 enum`. 내비게이션 코드와 독립적으로 단위 테스트 가능해야 한다.
- 파서 결과를 기존 내비게이션(탭 구조)에 연결해 해당 화면으로 이동.

## 4. 수동 설정 (카카오 콘솔, 코드 외 작업)

- 기존 카카오 앱(현재 REST 키를 쓰는 그 앱)에 **iOS 플랫폼 추가**: pt-mobile 번들 ID 등록.
- **네이티브 앱 키** 확인 → pt-mobile scheme 등록에 사용.
- 같은 카카오 앱 안에서 "REST 키로 발신, 네이티브 키 scheme으로 수신" 구조.

## 5. 구현 순서 — 스파이크 우선

최대 리스크: **카카오톡 iOS가 개인 서명(비스토어) 앱을 '설치됨'으로 인식하고 실행해 주는가.** 미설치로 판단하면 App Store로 보내는데 스토어에 없으므로 이 방식 전체가 무효가 된다.

1. **스파이크**: 콘솔 iOS 플랫폼 등록 + Info.plist scheme 등록만 하고, `kakao test` 메시지에 execution_params를 임시로 넣어 실기기에서 탭 → 앱 실행 확인.
   - 실패 시: 접근 B(브릿지 페이지)로 후퇴. 매몰 비용은 콘솔 설정 + plist 한 줄.
2. 성공 시 본 구현: 파서·라우팅·`sendTextToMe` 시그니처 확장·테스트.

## 6. 테스트

- portfolio-tracker: `KakaoNotifier.test.ts` 기존 패턴을 따라 template_object에 execution_params가 포함/미포함되는 경우 검증.
- pt-mobile: 파서 단위 테스트(정상 매핑, 미지원 값, 빈 쿼리) + 딥링크 → 화면 이동 위젯 테스트.
- E2E: 실기기에서 스캔 요약·오늘의 추천 각각 전송 → 탭 → 대상 화면 도착 확인.

## 범위 밖 (YAGNI)

- Android 실기기 지원(파라미터만 미리 넣고 검증은 안 함), Universal Links, 웹 리포트 페이지, 메시지 템플릿 리치화(feed 템플릿 등), `project=<id>` 상세 딥링크.
