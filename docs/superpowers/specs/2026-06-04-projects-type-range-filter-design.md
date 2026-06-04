# Projects type/range 필터 설계 (pt-mobile)

- 작성일: 2026-06-04
- 범위: pt-mobile 단일 레포. `ProjectQuery`에 type 필터 + 준비도 구간 필터 추가, ProjectsScreen에 인라인 컨트롤.
- 상태: 설계 승인됨, 구현 계획 작성 대기

## 1. 목표

Projects 화면의 필터를 확장한다. 현재 검색·우선순위·활성 필터에 더해 **프로젝트 타입 필터**와 **준비도 구간 필터**를 추가해, 큰 포트폴리오에서 원하는 프로젝트를 더 좁힐 수 있게 한다.

### 비목표 (YAGNI)
- 진행률 구간, 스택 필터, 날짜 필터: 범위 밖.
- 필터 바텀시트/저장된 필터 프리셋: 범위 밖(인라인 확장으로 충분).
- 타입 목록 하드코딩: 안 함 — 현재 스냅샷에 존재하는 타입에서 동적 생성.

## 2. 아키텍처

기존 파일만 수정. 신규 파일 없음.

### `lib/projects/project_query.dart` (수정)
`ProjectQuery`에 필드 추가:
```dart
final Set<String> types;       // 빈 set = 모든 타입
final int minReadiness;        // 기본 0
final int maxReadiness;        // 기본 100
```
- `apply(List<Project>)`에 두 조건 추가(기존 priority/active/search와 AND):
  - `types.isNotEmpty && !types.contains(p.type)` → 제외
  - `p.readiness < minReadiness || p.readiness > maxReadiness` → 제외
- `copyWith`에 `types`, `minReadiness`, `maxReadiness` 추가.
- 정렬 로직은 변경 없음.

### `lib/projects/projects_screen.dart` (수정)
- 현재 스냅샷 `scan.projects`의 distinct `type`을 정렬해 **타입 FilterChip 행** 추가(기존 `_FilterChips`와 동일 패턴, 가로 스크롤). 토글 → `query.types` 갱신.
- **준비도 RangeSlider**(0~100, divisions 20): 현재 `min/maxReadiness`를 값으로, `onChanged` → `copyWith(minReadiness:..., maxReadiness:...)`. 칩 영역 아래 별도 섹션. 양끝 값 라벨("준비도 {min}–{max}").
- 타입 목록은 `apply` 적용 전 전체 projects에서 뽑는다(필터로 사라진 타입도 다시 선택 가능하도록).

## 3. 데이터 흐름

```
projects(최신 스냅샷) → distinct types → 타입 칩
사용자 토글/슬라이드 → projectQueryProvider.update(copyWith) → query.apply(projects) → 리스트
```

## 4. 에러 처리 / 엣지

- `type` 'unknown'도 정상 칩으로 노출.
- 빈 `types` = 전체 통과. 슬라이더 기본 0~100 = 무필터.
- `minReadiness > maxReadiness`는 UI(RangeSlider)가 구조적으로 방지(start ≤ end). 로직은 그래도 `<min || >max`로 안전.
- 타입이 하나도 없으면(빈 스냅샷) 타입 칩 행은 비어 표시되지 않음(상위에서 빈/로딩 상태가 이미 처리).

## 5. 테스트 전략

- **`ProjectQuery`(순수, 핵심):**
  - 타입 필터: 선택 타입만 남김, 빈 set = 전체.
  - 준비도 구간: 구간 밖 제외, 경계 포함.
  - 기존 필터(search/priority/active)와 조합되는지.
  - `copyWith`가 새 필드만 교체.
- **`ProjectsScreen`(위젯):**
  - 타입 칩 탭 → 리스트가 해당 타입으로 좁혀짐.
  - RangeSlider와 타입 칩이 렌더되는지(존재 확인). 슬라이더 드래그 상호작용은 query 단위 테스트로 커버(위젯 드래그는 flaky하므로 존재만 확인).

## 6. 재사용 / 일관성

- 기존 `_FilterChips`/`FilterChip` 패턴, `projectQueryProvider`(StateProvider) `update` 흐름, `ProjectQuery.copyWith` 컨벤션 그대로.
- `flutter-tdd` 수직 슬라이스: 순수 로직 먼저, UI 통합 나중.
