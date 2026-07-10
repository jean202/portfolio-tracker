# 카카오톡 메시지 → pt-mobile 딥링크 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카카오톡 "나에게 보내기" 메시지를 탭하면 pt-mobile 앱이 메시지 종류에 맞는 탭(대시보드/추천)으로 열린다.

**Architecture:** portfolio-tracker가 카카오 텍스트 템플릿 `link`에 `ios_execution_params`(`screen=<값>`)를 실어 보내면, 카카오톡이 `kakao{네이티브앱키}://kakaolink?screen=<값>` 으로 앱을 실행한다. pt-mobile은 `app_links`로 URI를 수신하고 순수 함수 파서로 탭을 결정해 HomeShell의 NavigationBar 인덱스를 전환한다.

**Tech Stack:** TypeScript(vitest, commander) / Flutter(Riverpod, app_links) / Kakao Developers 콘솔

**Spec:** `docs/superpowers/specs/2026-07-10-kakao-deeplink-to-pt-mobile-design.md`

**저장소 2개를 다룬다:**
- 발신: `/Users/jean325/portfolio/portfolio-tracker` (Task 1–2)
- 수신: `/Users/jean325/portfolio/projects/pt-mobile` (Task 3–5)

**⚠️ 주의:** portfolio-tracker의 `src/cli/index.ts`에는 이 작업과 무관한 미커밋 변경(1053행 근처, recommend 점수 로직)이 이미 있다. 커밋할 때 `git add -p src/cli/index.ts`로 **kakao test 관련 hunk만** 스테이징할 것. 무관한 hunk를 절대 커밋하지 않는다.

**⚠️ 순서 제약:** Task 3(스파이크)이 실패하면 Task 4–5를 진행하지 않는다(스펙의 후퇴 경로 B 참조). Task 1–2는 스파이크 성공 여부와 무관하게 유효한 개선이므로 먼저 진행한다.

---

### Task 1: KakaoNotifier에 screen 파라미터 지원 (portfolio-tracker)

**Files:**
- Modify: `src/core/KakaoNotifier.ts:189-216` (`sendTextToMe`), `:181-187` (`sendPortfolioSummary`)
- Test: `src/core/KakaoNotifier.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/KakaoNotifier.test.ts`의 `"sends a text template to my chatroom"` 테스트 뒤에 추가:

```ts
it("includes execution params when screen is provided", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kakao-token-"));
  const tokenFile = path.join(tempDir, "token.json");
  await fs.writeFile(
    tokenFile,
    JSON.stringify({
      tokenType: "bearer",
      accessToken: "access",
      accessTokenExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      refreshToken: "refresh",
    }),
  );
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => "",
  });
  vi.stubGlobal("fetch", mockFetch);

  const notifier = new KakaoNotifier({
    restApiKey: "rest-key",
    tokenFile,
    linkUrl: "https://example.com",
  });
  await notifier.sendTextToMe("hello", { screen: "recommendations" });

  const body = mockFetch.mock.calls[0][1].body as URLSearchParams;
  const template = JSON.parse(body.get("template_object")!);
  expect(template.link.ios_execution_params).toBe("screen=recommendations");
  expect(template.link.android_execution_params).toBe(
    "screen=recommendations",
  );
  expect(template.link.web_url).toBe("https://example.com");
});

it("omits execution params when screen is not provided", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kakao-token-"));
  const tokenFile = path.join(tempDir, "token.json");
  await fs.writeFile(
    tokenFile,
    JSON.stringify({
      tokenType: "bearer",
      accessToken: "access",
      accessTokenExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      refreshToken: "refresh",
    }),
  );
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => "",
  });
  vi.stubGlobal("fetch", mockFetch);

  const notifier = new KakaoNotifier({ restApiKey: "rest-key", tokenFile });
  await notifier.sendTextToMe("hello");

  const body = mockFetch.mock.calls[0][1].body as URLSearchParams;
  const template = JSON.parse(body.get("template_object")!);
  expect(template.link.ios_execution_params).toBeUndefined();
  expect(template.link.android_execution_params).toBeUndefined();
});

it("sends portfolio summary with dashboard screen param", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kakao-token-"));
  const tokenFile = path.join(tempDir, "token.json");
  await fs.writeFile(
    tokenFile,
    JSON.stringify({
      tokenType: "bearer",
      accessToken: "access",
      accessTokenExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      refreshToken: "refresh",
    }),
  );
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => "",
  });
  vi.stubGlobal("fetch", mockFetch);

  const notifier = new KakaoNotifier({ restApiKey: "rest-key", tokenFile });
  await notifier.sendPortfolioSummary(makeScanResult(), null);

  const body = mockFetch.mock.calls[0][1].body as URLSearchParams;
  const template = JSON.parse(body.get("template_object")!);
  expect(template.link.ios_execution_params).toBe("screen=dashboard");
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd /Users/jean325/portfolio/portfolio-tracker && npx vitest run src/core/KakaoNotifier.test.ts`
Expected: 신규 3개 FAIL (컴파일 에러 — `sendTextToMe`가 두 번째 인자를 받지 않음)

- [ ] **Step 3: 최소 구현**

`src/core/KakaoNotifier.ts`에서 `sendTextToMe`와 `sendPortfolioSummary`를 수정:

```ts
export interface KakaoSendOptions {
  screen?: string;
}

// sendPortfolioSummary 내부:
async sendPortfolioSummary(
  result: ScanResult,
  diff: ScanDiff | null,
  options: NotificationPolicyOptions = {},
): Promise<void> {
  await this.sendTextToMe(buildKakaoScanMessage(result, diff, options), {
    screen: "dashboard",
  });
}

async sendTextToMe(
  text: string,
  options: KakaoSendOptions = {},
): Promise<void> {
  const accessToken = await this.ensureAccessToken();
  const link: Record<string, string> = {
    web_url: this.linkUrl,
    mobile_web_url: this.linkUrl,
  };
  if (options.screen) {
    const executionParams = `screen=${options.screen}`;
    link.ios_execution_params = executionParams;
    link.android_execution_params = executionParams;
  }
  const templateObject = {
    object_type: "text",
    text: truncateForKakao(text),
    link,
    button_title: "리포트 보기",
  };
  const body = new URLSearchParams({
    template_object: JSON.stringify(templateObject),
  });

  const response = await fetch(SEND_TO_ME_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(await formatKakaoError(response));
  }
}
```

`KakaoSendOptions`는 export해서 CLI에서 타입으로 쓸 수 있게 한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/core/KakaoNotifier.test.ts`
Expected: 전체 PASS (기존 테스트 포함)

- [ ] **Step 5: 커밋**

```bash
cd /Users/jean325/portfolio/portfolio-tracker
git add src/core/KakaoNotifier.ts src/core/KakaoNotifier.test.ts
git commit -m "feat: kakao 메시지에 딥링크 execution params 지원"
```

---

### Task 2: 발신 지점에 screen 값 연결 (portfolio-tracker)

**Files:**
- Modify: `src/cli/index.ts:562-572` (`kakao test` 커맨드) — ⚠️ 무관한 미커밋 hunk 주의 (헤더 참조)
- Modify: `scripts/kakao-briefing.mjs:84`
- Test: `src/cli/index.test.ts` (기존 테스트가 깨지지 않는지만 확인, 신규 테스트 없음 — 옵션 전달 한 줄이라 KakaoNotifier 테스트로 커버됨)

- [ ] **Step 1: `kakao test`에 `--screen` 옵션 추가**

`src/cli/index.ts`의 kakao test 커맨드를 다음으로 교체:

```ts
kakao
  .command("test")
  .description("카카오톡 나에게 테스트 메시지 전송")
  .option(
    "--screen <screen>",
    "딥링크 screen 파라미터 (dashboard | recommendations)",
  )
  .action(async (options: { screen?: string }) => {
    const notifier = await requireKakaoNotifier();
    await notifier.sendTextToMe(
      "[Portfolio Tracker]\n카카오톡 나에게 보내기 연동 테스트입니다.",
      { screen: options.screen },
    );

    console.log(chalk.green("✓ 카카오톡 나에게 테스트 메시지 전송 완료"));
  });
```

- [ ] **Step 2: kakao-briefing에 recommendations 지정**

`scripts/kakao-briefing.mjs`의 전송 줄을 교체:

```js
await notifier.sendTextToMe(message, { screen: "recommendations" });
```

- [ ] **Step 3: 전체 테스트 실행**

Run: `npx vitest run`
Expected: 전체 PASS

- [ ] **Step 4: 커밋 (부분 스테이징)**

```bash
git add scripts/kakao-briefing.mjs
git add -p src/cli/index.ts   # kakao test hunk만 선택(y), recommend 점수 hunk는 제외(n)
git commit -m "feat: 카카오 발신 지점별 딥링크 screen 값 연결"
git diff src/cli/index.ts     # 남은 diff가 recommend 점수 hunk뿐인지 확인
```

---

### Task 3: 카카오 콘솔 설정 + URL scheme 등록 + 스파이크 (pt-mobile, 사용자 개입 필요)

**Files:**
- Modify: `/Users/jean325/portfolio/projects/pt-mobile/ios/Runner/Info.plist`

**이 태스크는 사용자 수동 작업 2개(콘솔 설정, 실기기 확인)를 포함한다. 에이전트는 해당 지점에서 멈추고 사용자에게 요청할 것.**

- [ ] **Step 1 (사용자): Kakao Developers 콘솔 설정**

사용자에게 요청:
1. https://developers.kakao.com → 내 애플리케이션 → (현재 REST 키를 쓰는 그 앱)
2. 앱 설정 → 플랫폼 → **iOS 플랫폼 등록**: 번들 ID `com.portfoliotracker.ptMobile`
3. 앱 설정 → 앱 키 → **네이티브 앱 키** 복사해서 전달

- [ ] **Step 2: Info.plist에 URL scheme 등록**

`ios/Runner/Info.plist`의 `<dict>` 안(예: `LSRequiresIPhoneOS` 항목 뒤)에 추가. `{{NATIVE_APP_KEY}}`는 Step 1에서 받은 네이티브 앱 키로 치환:

```xml
<key>CFBundleURLTypes</key>
<array>
	<dict>
		<key>CFBundleTypeRole</key>
		<string>Editor</string>
		<key>CFBundleURLSchemes</key>
		<array>
			<string>kakao{{NATIVE_APP_KEY}}</string>
		</array>
	</dict>
</array>
```

- [ ] **Step 3 (사용자): 실기기 재설치 + 스파이크 확인**

사용자에게 요청:
1. iPhone 연결 후 `cd /Users/jean325/portfolio/projects/pt-mobile && flutter run --release` 로 재설치
2. Mac에서 `cd /Users/jean325/portfolio/portfolio-tracker && npx tsx src/cli/index.ts kakao test --screen dashboard` 실행
3. iPhone 카카오톡에서 도착한 메시지 탭 → **pt-mobile 앱이 실행되는지** 확인 (화면 전환은 아직 미구현, 앱만 뜨면 성공)

Expected: 앱 실행됨 → Task 4로 진행.
**실패 시 (앱스토어로 이동하거나 반응 없음): 여기서 중단하고 사용자와 접근 B(브릿지 페이지) 전환을 논의한다. Task 4–5 진행 금지.**

- [ ] **Step 4: 커밋**

```bash
cd /Users/jean325/portfolio/projects/pt-mobile
git add ios/Runner/Info.plist
git commit -m "feat: kakao 딥링크 URL scheme 등록"
```

---

### Task 4: 딥링크 파서 (pt-mobile, TDD)

**Files:**
- Create: `/Users/jean325/portfolio/projects/pt-mobile/lib/deeplink/deep_link_parser.dart`
- Test: `/Users/jean325/portfolio/projects/pt-mobile/test/deeplink/deep_link_parser_test.dart`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/deeplink/deep_link_parser_test.dart` 생성:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pt_mobile/deeplink/deep_link_parser.dart';

void main() {
  test('screen=dashboard maps to dashboard tab', () {
    final uri = Uri.parse('kakaokey://kakaolink?screen=dashboard');
    expect(parseDeepLinkTab(uri), HomeTab.dashboard);
  });

  test('screen=recommendations maps to recommendations tab', () {
    final uri = Uri.parse('kakaokey://kakaolink?screen=recommendations');
    expect(parseDeepLinkTab(uri), HomeTab.recommendations);
  });

  test('missing screen falls back to dashboard', () {
    expect(parseDeepLinkTab(Uri.parse('kakaokey://kakaolink')),
        HomeTab.dashboard);
  });

  test('unknown screen falls back to dashboard', () {
    expect(parseDeepLinkTab(Uri.parse('kakaokey://kakaolink?screen=bogus')),
        HomeTab.dashboard);
  });

  test('tab enum order matches HomeShell screen order', () {
    // HomeShell._screens: Dashboard, Projects, Recommendations, Trends,
    // Notifications — enum index가 NavigationBar 인덱스로 쓰인다.
    expect(HomeTab.dashboard.index, 0);
    expect(HomeTab.recommendations.index, 2);
  });
}
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd /Users/jean325/portfolio/projects/pt-mobile && flutter test test/deeplink/deep_link_parser_test.dart`
Expected: FAIL (파일 없음 — 컴파일 에러)

- [ ] **Step 3: 최소 구현**

`lib/deeplink/deep_link_parser.dart` 생성:

```dart
/// Bottom navigation tabs, in the same order as HomeShell's screen list.
/// The enum index doubles as the NavigationBar index.
enum HomeTab { dashboard, projects, recommendations, trends, notifications }

/// Maps an incoming deep link URI (kakao{APP_KEY}://kakaolink?screen=...)
/// to a tab. Unknown or missing screens fall back to the dashboard so a
/// bad link never surfaces an error.
HomeTab parseDeepLinkTab(Uri uri) {
  switch (uri.queryParameters['screen']) {
    case 'recommendations':
      return HomeTab.recommendations;
    default:
      return HomeTab.dashboard;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `flutter test test/deeplink/deep_link_parser_test.dart`
Expected: 5개 PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/deeplink/deep_link_parser.dart test/deeplink/deep_link_parser_test.dart
git commit -m "feat: 카카오 딥링크 → 탭 매핑 파서"
```

---

### Task 5: 딥링크 수신 배선 — app_links + HomeShell (pt-mobile, TDD)

**Files:**
- Create: `lib/deeplink/deep_link_providers.dart`
- Modify: `lib/shell/home_shell.dart`, `lib/main.dart`, `pubspec.yaml`
- Test: `test/shell/home_shell_test.dart`

- [ ] **Step 1: app_links 의존성 추가**

Run: `cd /Users/jean325/portfolio/projects/pt-mobile && flutter pub add app_links`
Expected: pubspec.yaml에 `app_links: ^X.Y.Z` 추가됨

- [ ] **Step 2: 딥링크 스트림 provider 생성**

`lib/deeplink/deep_link_providers.dart` 생성:

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Incoming deep link URIs. Overridden in main() with the real app_links
/// stream; defaults to empty so tests without deep links need no override.
final deepLinkUriStreamProvider =
    Provider<Stream<Uri>>((ref) => const Stream<Uri>.empty());
```

- [ ] **Step 3: 실패하는 위젯 테스트 작성**

`test/shell/home_shell_test.dart`에 추가 — 상단 import에 아래를 더한다:

```dart
import 'dart:async';
import 'package:pt_mobile/deeplink/deep_link_providers.dart';
```

기존 `switches to Recommendations tab` 테스트 뒤에 추가 (오버라이드 구성은 그 테스트와 동일한 패턴):

```dart
testWidgets('deep link switches to Recommendations tab', (tester) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  final links = StreamController<Uri>();
  addTearDown(links.close);
  final c = ProviderContainer(overrides: [
    databaseProvider.overrideWith((ref) {
      final db = SnapshotDatabase(openConnection(inMemory: true));
      ref.onDispose(db.close);
      return db;
    }),
    interactionStoreProvider.overrideWithValue(InteractionStore(prefs)),
    deepLinkUriStreamProvider.overrideWithValue(links.stream),
  ]);
  addTearDown(c.dispose);
  await tester.pumpWidget(UncontrolledProviderScope(
    container: c,
    child: const MaterialApp(home: HomeShell()),
  ));
  await tester.pumpAndSettle();
  expect(find.byType(DashboardScreen), findsOneWidget);

  links.add(Uri.parse('kakaokey://kakaolink?screen=recommendations'));
  await tester.pumpAndSettle();
  expect(find.byType(RecommendationsScreen), findsOneWidget);
  expect(find.byType(DashboardScreen), findsNothing);
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `flutter test test/shell/home_shell_test.dart`
Expected: 신규 테스트 FAIL (HomeShell이 스트림을 구독하지 않아 Dashboard에 머무름)

- [ ] **Step 5: HomeShell이 딥링크 스트림을 구독하게 수정**

`lib/shell/home_shell.dart` 전체를 다음으로 교체:

```dart
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../dashboard/dashboard_screen.dart';
import '../deeplink/deep_link_parser.dart';
import '../deeplink/deep_link_providers.dart';
import '../projects/projects_screen.dart';
import '../notifications/notifications_screen.dart';
import '../recommendations/recommendations_screen.dart';
import '../trends/trends_screen.dart';

/// Root navigation shell. Provides the bottom NavigationBar; each tab screen
/// keeps its own AppBar/FAB. Only the active screen is mounted.
/// Deep links (kakao message taps) switch the active tab via
/// [deepLinkUriStreamProvider].
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});
  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _index = 0;
  StreamSubscription<Uri>? _linkSubscription;

  static const _screens = [
    DashboardScreen(),
    ProjectsScreen(),
    RecommendationsScreen(),
    TrendsScreen(),
    NotificationsScreen(),
  ];

  @override
  void initState() {
    super.initState();
    _linkSubscription = ref.read(deepLinkUriStreamProvider).listen((uri) {
      if (mounted) setState(() => _index = parseDeepLinkTab(uri).index);
    });
  }

  @override
  void dispose() {
    _linkSubscription?.cancel();
    super.dispose();
  }

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
          NavigationDestination(icon: Icon(Icons.show_chart), label: 'Trends'),
          NavigationDestination(icon: Icon(Icons.notifications), label: 'Alerts'),
        ],
      ),
    );
  }
}
```

- [ ] **Step 6: main()에서 실제 app_links 스트림 연결**

`lib/main.dart` 수정 — import 추가:

```dart
import 'package:app_links/app_links.dart';
import 'deeplink/deep_link_providers.dart';
```

`main()`의 overrides에 항목 추가 및 파일 하단에 헬퍼 추가:

```dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  final notifier = PluginLocalNotifier(RealNotificationApi());
  await notifier.init();
  runApp(ProviderScope(
    overrides: [
      deepLinkUriStreamProvider.overrideWithValue(_deepLinkUris(AppLinks())),
      localNotifierProvider.overrideWithValue(notifier),
      interactionStoreProvider.overrideWithValue(InteractionStore(prefs)),
      notificationSettingsStoreProvider
          .overrideWithValue(NotificationSettingsStore(prefs)),
      notificationHistoryStoreProvider
          .overrideWithValue(NotificationHistoryStore(prefs)),
    ],
    child: const PtMobileApp(),
  ));
}

/// Cold-start link first, then live links. If the plugin also replays the
/// initial link on the stream, the duplicate tab switch is harmless.
Stream<Uri> _deepLinkUris(AppLinks appLinks) async* {
  final initial = await appLinks.getInitialLink();
  if (initial != null) yield initial;
  yield* appLinks.uriLinkStream;
}
```

참고: `getInitialLink()`가 현재 app_links 버전에서 이름이 다르면(`getInitialAppLink` 등) 패키지 API 문서에 맞춰 조정한다. 스트림 시맨틱(초기 링크 1회 + 이후 라이브 링크)만 유지하면 된다.

- [ ] **Step 7: 전체 테스트 통과 확인**

Run: `flutter test`
Expected: 전체 PASS (기존 ~90개 + 신규)

- [ ] **Step 8: 커밋**

```bash
git add pubspec.yaml pubspec.lock lib/deeplink/deep_link_providers.dart lib/shell/home_shell.dart lib/main.dart test/shell/home_shell_test.dart
git commit -m "feat: app_links로 카카오 딥링크 수신, 탭 전환 배선"
```

---

### Task 6: E2E 검증 (사용자 개입 필요)

- [ ] **Step 1 (사용자): 재설치 후 시나리오 확인**

사용자에게 요청:
1. `cd /Users/jean325/portfolio/projects/pt-mobile && flutter run --release` 로 재설치
2. Mac에서 각각 전송 후 iPhone에서 메시지 탭:
   - `npx tsx src/cli/index.ts kakao test --screen recommendations` → 탭 시 **Recommend 탭**으로 열림
   - `npx tsx src/cli/index.ts kakao test --screen dashboard` → 탭 시 **Dashboard 탭**으로 열림
   - `node scripts/kakao-briefing.mjs` → 탭 시 **Recommend 탭**으로 열림
3. 앱이 **이미 실행 중일 때**(백그라운드) 메시지 탭 → 탭 전환되는지도 확인 (콜드 스타트와 웜 링크 둘 다 검증)

- [ ] **Step 2: 결과 보고**

전부 성공하면 완료. 부분 실패(예: 콜드 스타트만 안 됨)는 `_deepLinkUris`의 초기 링크 처리를 의심하고 systematic-debugging으로 진입.
