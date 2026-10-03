# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **데이터 저장 위치 고정**: 설정·스캔 결과·히스토리·토큰을 실행 폴더 대신 `~/.portfolio-tracker/`에 저장
  - `PORTFOLIO_TRACKER_HOME` 환경변수로 위치 변경 가능
  - 첫 실행 시 예전 위치(현재 폴더, 저장소 폴더)의 파일을 자동 복사

### Added
- **History/Trend Analysis**: 시계열 데이터 자동 저장 및 분석
  - `history` 커맨드: 전체 스캔 히스토리 또는 특정 프로젝트의 진행 추이
  - `diff` 커맨드: 이전 스캔과 비교 (요약 변화, 새/사라진 프로젝트, TOP movers)
  - `trends` 커맨드: 시각적 바 차트로 트렌드 분석
- **HistoryStore**: 자동 히스토리 저장 (`.portfolio-tracker/history/<timestamp>.json`)
- **TrendAnalyzer**: 두 스캔 비교 및 트렌드 데이터 생성 로직
- 17개 새 테스트 (HistoryStore 7개, TrendAnalyzer 10개)

### Changed
- `ScanStore.save()`가 자동으로 히스토리에도 저장하도록 변경

## [0.1.0] - 2026-04-30

### Added
- **Interactive Init**: 대화형 초기화로 프로젝트 디렉토리 쉽게 설정
- **Detail Command**: 프로젝트 상세 정보 조회 (`portfolio-tracker detail <project>`)
- **Portfolio Readiness Score**: 진행률, 활동성, 문서화 수준을 종합한 0~100 준비도 점수
- **Progress Signals & Confidence**: 진행률 추정의 근거(signals)와 신뢰도(confidence) 표시
- **Signals Display**: 마크다운, HTML, 콘솔에서 진행률 근거 표시
- **Extended Document Scanning**: README, CLAUDE.md, PROJECT_PLAN.md, AGENTS.md, TODO.md, mvp-plan.md, docs/*.md 스캔
- **Heuristic Progress Detection**: 키워드 기반 휴리스틱 진행률 추론 (배포완료, MVP, 테스트필요 등)
- **Multiple Output Formats**: Console, Markdown, HTML, JSON 리포트 지원
- **Project Discovery**: 자동 프로젝트 감지 (README, Git, package.json, pubspec.yaml 등)
- **Priority Classification**: 프로젝트 상태에 따라 CRITICAL/HIGH/MEDIUM/LOW 자동 분류
- **Technology Stack Detection**: 기술 스택 자동 감지 (React, Node.js, Flutter, Docker 등)
- **Next Actions Extraction**: 문서에서 할 일 자동 추출
- **Caching**: 스캔 결과 캐싱으로 빠른 조회

### Features
- 📁 자동 프로젝트 감지
- 📊 진행률 자동 추적 (명시적, 체크박스, 휴리스틱)
- 🎯 신뢰도 & 근거 표시
- 📈 포트폴리오 준비도 점수 (0~100)
- 📝 다양한 출력 형식 (Console, Markdown, HTML, JSON)
- 🏷️ 우선순위 자동 분류
- 🔄 캐시 지원
- ⚙️ 설정 관리 (add/remove/list)
- 🔍 프로젝트 상세 조회

### Technical Details
- **Technology**: TypeScript, Node.js, Commander.js, Inquirer.js
- **Testing**: Vitest (14개 테스트 통과)
- **Linting**: ESLint
- **Code Quality**: No vulnerabilities

---

## Version History

### 0.1.0 (Initial Release)
- All core features implemented
- Fully tested and documented
- Ready for production use

---

## Roadmap

### Planned Features (v0.2.0)
- [ ] Incremental scanning (증분 스캔)
- [ ] Trend analysis (트렌드 분석)
- [ ] Project search filters (프로젝트 검색)
- [ ] Weekly/monthly statistics (통계 요약)
- [ ] CI/CD integration templates (GitHub Actions)

### Future Enhancements (v0.3.0+)
- [ ] Live dashboard web server
- [ ] Team collaboration features
- [ ] Email/Slack notifications
- [ ] Contributor statistics
- [ ] Time-series progress tracking
