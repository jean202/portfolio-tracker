# CI/CD 설계 (v0.2.0)

## 목표

GitHub Actions로 두 가지 자동화를 구축한다:
1. **CI** — 모든 push/PR에서 테스트·빌드 자동 실행
2. **Pages 배포** — `scan-result.json`이 main에 push되면 HTML 리포트를 GitHub Pages에 자동 배포

---

## 접근법

워크플로우 2개를 분리해 관심사를 명확히 구분한다. CI 실패가 배포 로직에 영향을 주지 않고, `scan-result.json` 변경 시에만 Pages 배포가 트리거된다.

---

## 워크플로우 1: CI (`.github/workflows/ci.yml`)

### 트리거
- `push` — 모든 브랜치
- `pull_request` — `main` 대상

### 실행 단계
1. `actions/checkout@v4`
2. `actions/setup-node@v4` (Node 20, npm 캐시)
3. `npm ci`
4. `npm run build`
5. `npx vitest run`

### 전체 YAML

```yaml
name: CI

on:
  push:
    branches: ["**"]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npx vitest run
```

---

## 워크플로우 2: Pages 배포 (`.github/workflows/pages.yml`)

### 트리거
- `push` — `main` 브랜치, `.portfolio-tracker/scan-result.json` 변경 시에만

### 실행 단계
1. `actions/checkout@v4`
2. `actions/setup-node@v4` (Node 20, npm 캐시)
3. `npm ci && npm run build`
4. `node dist/cli/index.js export -f html -o _site/index.html --all`
5. `actions/upload-pages-artifact@v3` (`_site/` 디렉토리)
6. `actions/deploy-pages@v4` → Pages 배포

### 권한
- `pages: write`
- `id-token: write`

### 환경
- `github-pages` (배포 URL이 Actions 출력으로 반환됨)

### 전체 YAML

```yaml
name: Deploy Portfolio Report

on:
  push:
    branches: [main]
    paths:
      - .portfolio-tracker/scan-result.json

permissions:
  pages: write
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci && npm run build
      - run: node dist/cli/index.js export -f html -o _site/index.html --all
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site
      - id: deploy
        uses: actions/deploy-pages@v4
```

---

## `.gitignore` 수정

현재 `.portfolio-tracker/`가 통째로 gitignored. `scan-result.json`만 추적하도록 예외 추가:

```gitignore
.portfolio-tracker/
!.portfolio-tracker/scan-result.json
```

---

## 변경 파일 요약

| 파일 | 작업 |
|------|------|
| `.github/workflows/ci.yml` | 새 파일 |
| `.github/workflows/pages.yml` | 새 파일 |
| `.gitignore` | 예외 한 줄 추가 |

---

## GitHub 설정 (수동)

배포 전 한 번만 설정:
> repo Settings → Pages → Source → **GitHub Actions** 선택

---

## 로컬 사용 워크플로우

```bash
# 스캔 후 결과 커밋
portfolio-tracker scan
git add .portfolio-tracker/scan-result.json
git commit -m "chore: update portfolio scan"
git push
# → CI 즉시 실행, Pages 약 1분 내 배포
```

---

## 엣지 케이스

| 상황 | 동작 |
|------|------|
| `scan-result.json` 없이 push | Pages 워크플로우 트리거 안 됨 |
| export 실패 | 워크플로우 실패, Pages 이전 버전 유지 |
| CI 실패 | Pages 배포와 무관, 독립 실행 |
| 처음 배포 | GitHub Pages 설정이 안 되어 있으면 deploy-pages 단계 실패 |
