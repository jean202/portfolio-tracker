# 증분 스캔 설계 (v0.2.0)

## 목표

`portfolio-tracker scan --incremental` 플래그를 추가해, 마지막 스캔 이후 변경된 프로젝트만 재분석한다. 변경되지 않은 프로젝트는 마지막 `scan-result.json`의 캐시 데이터를 재사용한다.

---

## 변경 감지 기준

프로젝트가 "변경됨"으로 판단되는 조건:

| 프로젝트 유형 | 판단 기준 |
|--------------|----------|
| git 있음 | 마지막 커밋 날짜 > 마지막 스캔 `scannedAt` |
| git 없음 | 주요 파일(README.md, CLAUDE.md, PROJECT_PLAN.md, TODO.md, package.json 등) 중 하나라도 mtime > `scannedAt` |

기준 시각: `ScanStore`에 저장된 마지막 `scan-result.json`의 `scannedAt` 필드.

---

## 전체 흐름

```
portfolio-tracker scan --incremental
        │
        ▼
ScanStore에서 마지막 scan-result.json 로드
        │
   캐시 없음? ──→ 풀 스캔 fallback (기존 동작) + 안내 메시지 출력
        │
        ▼
scanProjectDirs()로 파일시스템 프로젝트 후보 목록 수집
        │
  각 프로젝트에 대해:
  ┌──────────────────────────────────────────────┐
  │ 캐시에 없는 새 프로젝트?  ──→ 풀 분석        │
  │                                              │
  │ git 있음?  ──→ git log -1 날짜 비교          │
  │             변경됨 ──→ 재스캔                │
  │             변경 없음 ──→ 캐시 재사용        │
  │                                              │
  │ git 없음?  ──→ 주요 파일 mtime 비교          │
  │             변경됨 ──→ 재스캔                │
  │             변경 없음 ──→ 캐시 재사용        │
  └──────────────────────────────────────────────┘
        │
        ▼
캐시에만 있고 파일시스템에 없는 프로젝트 → 결과에서 제거
        │
        ▼
새 ScanResult 생성 (재스캔 결과 + 캐시 혼합)
ScanStore 저장 + HistoryStore 저장
```

---

## 코드 변경 범위

### `src/core/Scanner.ts`

메서드 1개 추가, 헬퍼 1개 추가:

```ts
// 증분 스캔 진입점
async scanIncremental(lastResult: ScanResult): Promise<ScanResult>

// 프로젝트 변경 여부 판단
private async isProjectChanged(
  candidate: ProjectCandidate,
  lastScannedAt: Date,
): Promise<boolean>
```

`isProjectChanged` 구현:
- `candidate.hasGit === true`: `simpleGit(candidate.path).log({ maxCount: 1 })` → `latest.date > lastScannedAt`
- `candidate.hasGit === false`: `fs.stat(filePath)` for each key file → any `mtimeMs > lastScannedAt.getTime()`

`scanIncremental` 구현:
1. `scanProjectDirs()`로 현재 후보 수집
2. 각 후보에 대해 `isProjectChanged` 호출
3. 변경됨 또는 신규 → `analyzeProject(candidate)`
4. 변경 없음 → `lastResult.projects.find(p => p.id === slug(candidate.path))`
5. 누락(삭제된 프로젝트)은 자동 제거
6. `buildSummary(projects)`로 요약 재계산
7. `scannedAt: new Date()` 로 새 ScanResult 반환

### `src/cli/index.ts`

**`scan` 커맨드:**
```ts
.option("--incremental", "변경된 프로젝트만 재스캔")
```

출력 예시:
```
🔍 증분 스캔 중... (마지막 스캔: 2일 전)
  ✓ asset-radar — 변경됨, 재스캔
  ✓ portfolio-tracker — 변경 없음, 캐시 사용
✓ 12개 프로젝트 (2개 재스캔, 10개 캐시)
```

**`report` 커맨드:**
```ts
.option("--incremental", "증분 스캔으로 새로고침 (--refresh와 함께 사용)")
```

`loadScanResult()` 함수 시그니처 변경:
```ts
async function loadScanResult(options: {
  refresh?: boolean;
  incremental?: boolean;
}): Promise<{ result: ScanResult; fromCache: boolean }>
```

`--refresh --incremental` 조합 시 증분 스캔, `--refresh`만이면 풀 스캔.

---

## 엣지 케이스

| 상황 | 동작 |
|------|------|
| 캐시(scan-result.json) 없음 | 풀 스캔 fallback + "캐시 없음, 전체 스캔으로 진행합니다" 메시지 |
| 프로젝트 삭제됨 | 파일시스템 후보에 없으면 결과에서 자동 제거 |
| 새 프로젝트 추가됨 | 항상 풀 분석 |
| git 커밋 날짜 읽기 실패 | 변경됨으로 간주해 재스캔 (안전한 방향) |
| mtime 읽기 실패 | 변경됨으로 간주해 재스캔 |

---

## 테스트

기존 `Scanner.test.ts` 패턴을 따라 다음 케이스 추가:

1. **변경된 프로젝트 재스캔** — `isProjectChanged`가 true 반환 → `analyzeProject` 호출
2. **변경 없는 프로젝트 캐시 재사용** — `isProjectChanged`가 false 반환 → 캐시 데이터 그대로
3. **캐시 없을 때 fallback** — `scanIncremental`에 빈 lastResult 전달 시 풀 스캔과 동일 결과
4. **새 프로젝트** — 캐시에 없는 후보는 항상 재스캔
5. **삭제된 프로젝트** — 파일시스템에 없으면 결과에서 제거

---

## 변경 파일 요약

| 파일 | 변경 내용 |
|------|----------|
| `src/core/Scanner.ts` | `scanIncremental()`, `isProjectChanged()` 추가 |
| `src/cli/index.ts` | `scan --incremental`, `report --incremental` 플래그 추가, `loadScanResult()` 시그니처 변경 |

새 파일 없음. 기존 `ScanStore`, `HistoryStore` 인터페이스 변경 없음.
