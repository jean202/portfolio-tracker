# Daemon 모드 + Webhook 설계 (v0.2.0)

## 목표

`portfolio-tracker watch` (포그라운드 주기 스캔)와 `portfolio-tracker service` (macOS launchd 백그라운드 서비스)를 완성하고, 변경 감지 시 webhook POST 전송을 추가한다.

---

## 현재 상태

이미 구현·빌드 성공된 것:

| 파일 | 상태 |
|------|------|
| `src/core/Interval.ts` | 완성 + 테스트 |
| `src/core/LaunchAgent.ts` | 완성 + 테스트 |
| `src/cli/index.ts` — `watch` 커맨드 | 완성 (커밋 안 됨) |
| `src/cli/index.ts` — `service install/start/stop/restart/uninstall/status/logs` | 완성 (커밋 안 됨) |
| `src/config/ConfigManager.ts` | 포맷팅 수정 (커밋 안 됨) |

추가할 것: **WebhookNotifier** + `watch` 루프에 webhook 호출 통합.

---

## 전체 구조

```
portfolio-tracker watch --interval 1h
  │
  ├── 매 주기마다 scanner.scan() 실행
  ├── ScanStore + HistoryStore에 저장 (기존)
  ├── 콘솔에 요약 출력 (기존)
  └── WebhookNotifier.shouldNotify(diff) → notify(payload)

portfolio-tracker service install --interval 1h
  └── LaunchAgent가 launchd plist 생성 → 로그인 시 watch 자동 실행
```

---

## Webhook 상세 설계

### 설정

`config.json`의 `Config` 인터페이스에 옵션 필드 추가:

```ts
// src/core/ProjectModel.ts
export interface Config {
  projectDirs: string[];
  scanInterval?: number;
  excludePatterns?: string[];
  webhookUrl?: string;   // 추가
}
```

### 트리거 조건

`WebhookNotifier.shouldNotify(diff: ReturnType<typeof TrendAnalyzer.diff>): boolean`

둘 중 하나라도 해당하면 POST 전송:
- 새 프로젝트 추가 (`diff.projects.some(p => p.status === "new")`)
- 프로젝트 삭제 (`diff.projects.some(p => p.status === "removed")`)
- 어떤 프로젝트든 진행률 변화 절댓값 ≥ 5 (`Math.abs(progressChange) >= 5`)

### Payload

```ts
interface WebhookPayload {
  scannedAt: string;        // ISO 8601
  summary: {
    total: number;
    active: number;
    avgProgress: number | null;
    avgReadiness: number;
  };
  changes: {
    added: string[];        // 프로젝트 이름
    removed: string[];
    changed: Array<{
      name: string;
      progressBefore: number | null;
      progressAfter: number | null;
      readinessBefore: number;
      readinessAfter: number;
    }>;
  };
}
```

### WebhookNotifier 클래스

```ts
// src/core/WebhookNotifier.ts
export class WebhookNotifier {
  constructor(private readonly url: string) {}

  static shouldNotify(diff: ScanDiff): boolean

  async notify(payload: WebhookPayload): Promise<void>
    // Node.js 내장 fetch 사용
    // 실패 시 throw (호출자가 catch하고 콘솔 경고 출력)
}
```

`ScanDiff`는 `TrendAnalyzer.diff()`의 반환 타입.

### `watch` 루프 통합

기존 `run()` 함수 내 스캔 완료 후:

```
스캔 완료 → store.save(result)
         → config.webhookUrl이 있으면:
             이전 결과 로드 (historyStore의 2번째 최근 결과)
             diff 계산
             WebhookNotifier.shouldNotify(diff) → notify(payload)
             실패 시 console.warn("⚠ Webhook 전송 실패: ...")
```

---

## 변경 파일 요약

| 파일 | 변경 내용 |
|------|----------|
| `src/core/ProjectModel.ts` | `Config.webhookUrl?: string` 추가 |
| `src/core/WebhookNotifier.ts` | 새 파일 |
| `src/core/WebhookNotifier.test.ts` | 새 파일 |
| `src/cli/index.ts` | `watch` 루프에 webhook 호출 추가, 기존 커밋 안 된 변경 포함 |
| `src/config/ConfigManager.ts` | 포맷팅 수정 (이미 됨) |
| `src/core/Interval.ts` + test | 커밋만 |
| `src/core/LaunchAgent.ts` + test | 커밋만 |

새 외부 의존성 없음 — Node.js 내장 `fetch` 사용.

---

## 엣지 케이스

| 상황 | 동작 |
|------|------|
| `webhookUrl` 미설정 | webhook 스킵, 정상 동작 |
| webhook POST 실패 (네트워크 오류) | `console.warn` 출력, 스캔은 계속 진행 |
| 첫 번째 스캔 (이전 결과 없음) | diff 불가 → webhook 스킵 |
| 변경 없음 | `shouldNotify` false → webhook 스킵 |
| macOS 외 OS에서 `service` 커맨드 | `LaunchAgent`가 에러 throw ("macOS만 지원") |

---

## 테스트

`WebhookNotifier.test.ts`:
1. `shouldNotify` — 새 프로젝트 있으면 true
2. `shouldNotify` — 삭제된 프로젝트 있으면 true
3. `shouldNotify` — 진행률 5%p 이상 변화 있으면 true
4. `shouldNotify` — 변경 없으면 false
5. `notify` — 올바른 URL로 fetch POST 전송 (fetch mocking)
6. `notify` — fetch 실패 시 throw

기존 테스트 (`Interval.test.ts`, `LaunchAgent.test.ts`) 커밋 후 포함.
