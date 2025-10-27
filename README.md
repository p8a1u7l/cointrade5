# Cointrade5 Zenith Suite 설정 가이드

이 문서는 프로젝트를 실행하기 전에 사용자가 직접 채워야 하는 모든 수동 설정 항목을 정리합니다. 백엔드와 프런트엔드를 부팅하기 전에 아래 체크리스트를 빠짐없이 완료하세요.

## 1. 필수 의존성 설치
- 워크스페이스 전체 의존성 설치: `npm install --prefix zenith`
- 백엔드 또는 패키지 단위로 빌드를 건너뛰더라도 위 명령은 **필수**입니다. `tsx` 런타임과 공유 패키지를 제공해 TypeScript 모듈 폴백이 가능하도록 합니다.

## 2. `zenith/backend/.env`
백엔드는 실행 시 `.env` 파일을 자동으로 로드합니다. 파일이 없으면 실행이 실패합니다. 다음 항목을 반드시 채워 넣으세요.

| 키 | 필수 여부 | 설명 | 기본값/비고 |
| --- | --- | --- | --- |
| `BINANCE_API_KEY` | 예 | 바이낸스 선물 API 키 | 없음 (직접 입력)
| `BINANCE_API_SECRET` | 예 | 바이낸스 선물 API 시크릿 | 없음 (직접 입력)
| `BINANCE_USE_TESTNET` | 권장 | 테스트넷 여부 (`true`/`false`) | `true`
| `STRATEGY_MODE` | 상황별 | `scalp` (기본) 또는 `llm`. `llm` 선택 시 아래 OpenAI 키 필수 | `scalp`
| `OPENAI_API_KEY` | STRATEGY_MODE가 `llm`이면 예 | GPT-5 Pro 전략 호출용 OpenAI 키 | `scalp` 모드에서는 비워 둘 수 있으나 LLM 백업 호출을 사용하려면 입력
| `SYMBOL_DISCOVERY_*` | 선택 | 심볼 스캐너 세부 파라미터. 빈 값이면 기본값 사용 | 예: `SYMBOL_DISCOVERY_TOP_LIMIT=400` |
| `INITIAL_BALANCE` | 선택 | 대시보드 초기 계좌 잔고 표시 | `100000`
| `LOOP_INTERVAL_SECONDS` | 선택 | 자동 루프 주기(초) | `30`
| `MAX_POSITION_LEVERAGE` | 선택 | 최대 레버리지 | `5`
| `USER_CONTROL_*` | 선택 | 대시보드 다이얼(레버리지, 자본 비율) 범위 | 표준 프리셋 적용 |
| `FEATURE_SERVICE_URL` | 선택 | 피처 서비스 HTTP 엔드포인트 | `http://localhost:4000/api/features`
| `DL_SERVICE_URL` | 선택 | 딥러닝 시그널 서비스 URL | `http://localhost:4500/api/dl`
| `NSW_SERVICE_URL` | 선택 | 뉴럴 슬리피지 와치(NSW) 서비스 URL | `http://localhost:4501/api/nsw`
| `POLICY_SERVICE_URL` | 선택 | 정책 모델 서비스 URL | `http://localhost:4502/api/policy`
| `INTEREST_WATCHER_ENABLED` | 선택 | 뉴스/커뮤니티 관심도 수집 사용 여부 | `true`
| `INTEREST_WATCHER_PROJECT_DIR` | 선택 | 관심도 패키지 루트 경로 | 기본: `packages/interest-watcher`
| `INTEREST_WATCHER_DATA_DIR` | 선택 | 관심도 JSON이 저장될 디렉터리 | 기본: `<project>/news_interest`
| `INTEREST_WATCHER_STATE_DIR` | 선택 | 관심도 상태 캐시 디렉터리 | 기본: `<project>/.interest_state`
| `INTEREST_WATCHER_DIST_MODULE` | 선택 | 빌드된 JS 모듈 경로. 빌드를 건너뛰면 비워 두고 TypeScript 폴백 사용 | 기본: `dist/packages/interest-watcher/index.js`
| `INTEREST_WATCHER_MIN_SCORE` | 선택 | 관심도 순위 필터 | `2.0`
| `INTEREST_WATCHER_MAX_SYMBOLS` | 선택 | 백엔드가 유지하는 최대 관심 심볼 수 | `8`

> 참고: `.env`에 빈 문자열을 넣으면 로더가 값을 무시하므로, 사용하지 않을 항목은 키를 생략하세요.

## 3. `zenith/packages/interest-watcher/.env`
백엔드가 TypeScript 원본을 직접 로드할 때 이 패키지의 `.env` 파일도 함께 적용됩니다. 뉴스/커뮤니티 스캐너를 사용하려면 다음 항목을 준비하세요.

| 키 | 필수 여부 | 설명 | 기본값/비고 |
| --- | --- | --- | --- |
| `CRYPTOPANIC_TOKEN` | 권장 | CryptoPanic API 토큰. 설정하지 않으면 CryptoPanic 데이터는 제외됩니다. | 없음 (입력 필요)
| `OUT_DIR` | 선택 | 수집 결과(JSON)를 저장할 경로 | `news_interest`
| `STATE_DIR` | 선택 | 러닝 상태 캐시 경로 | `.interest_state`
| `WINDOW_MIN` | 선택 | 관심도 이동 창 크기(분) | `180`
| `BASE_EWMA_DECAY` | 선택 | EWMA 감쇠 계수 | `0.2`
| `HOT_Z` | 선택 | 관심도 점수 Z-스코어 임계값 | `2.0`
| `MIN_COUNT` | 선택 | 최소 언급 횟수 | `3`
| `MIN_SOURCES` | 선택 | 최소 소스 수 | `2`
| `TIMEOUT_MS` | 선택 | HTTP 요청 타임아웃 | `8000`
| `RETRY` | 선택 | HTTP 재시도 횟수 | `3`
| `PAUSE_MS` | 선택 | 연속 요청 사이 대기(ms) | `300`
| `REDDIT_SUBS` | 선택 | 모니터링할 서브레딧 목록(콤마 구분) | `Cryptocurrency,BitcoinMarkets,ethtrader`
| `REDDIT_LIMIT` | 선택 | 서브레딧 당 게시물 최대 수 | `25`
| `REDDIT_SORT` | 선택 | 정렬 기준(`new`, `hot`, `rising`, `top`) | `new`
| `REDDIT_PAUSE_MS` | 선택 | 서브레딧 순회 사이 대기(ms) | `500`
| `REDDIT_USER_AGENT` | 선택 | Reddit 요청 User-Agent | `script:interest-trend-watcher:1.0 (by /u/interestwatcher)`

- 백엔드 `INTEREST_WATCHER_DATA_DIR` 또는 `STATE_DIR`을 커스터마이징했다면, 이 파일에서도 `OUT_DIR`/`STATE_DIR` 값을 동일하게 맞추세요. 일치하지 않으면 서로 다른 위치에 파일이 생성됩니다.

## 4. `zenith/frontend/.env`
프런트엔드는 Vite 환경 변수를 통해 백엔드 엔드포인트를 참조합니다.

```bash
VITE_API_BASE_URL=http://localhost:8080          # 필수: 백엔드 REST 루트
VITE_METRICS_ENDPOINT=http://localhost:8080/metrics  # 선택: 기본값은 API_BASE_URL/metrics
VITE_MOVERS_ENDPOINT=http://localhost:8080/movers    # 선택
VITE_SIGNALS_ENDPOINT=http://localhost:8080/signals  # 선택
VITE_CHARTS_ENDPOINT=http://localhost:8080/charts    # 선택
VITE_SYMBOLS=BTCUSDT,ETHUSDT                         # 초기 대시보드 심볼 목록
```

## 5. 실행 순서 요약
1. `npm install --prefix zenith`
2. 위 세 위치의 `.env` 파일을 작성하고 자격 증명(바이낸스, OpenAI, CryptoPanic 등)을 입력합니다.
3. 백엔드 실행:
   ```bash
   cd zenith/backend
   npm run start
   ```
4. 프런트엔드 실행:
   ```bash
   cd zenith/frontend
   npm install
   npm run dev
   ```

## 6. 추가 체크사항
- 백엔드가 생성하는 뉴스/관심 데이터는 기본적으로 `zenith/packages/interest-watcher/news_interest`와 `zenith/packages/interest-watcher/.interest_state`에 저장됩니다. 커스텀 경로를 사용하는 경우 해당 디렉터리가 쓰기 가능해야 합니다.
- `zenith/backend/src/config.js`에서 `STRATEGY_MODE=llm`으로 설정하면 OpenAI 호출이 필수가 되며, LLM 결과가 지연되면 자동으로 실패 처리됩니다.
- 정책/딥러닝/피처 서비스 URL을 로컬 모킹 서버로 교체할 수 있습니다. 미구동 상태로 두면 호출이 실패하므로 필요 시 프록시 서버를 준비하세요.
- `.env` 파일이 Git에 커밋되지 않도록 루트 `.gitignore`가 이미 설정되어 있습니다. 자격 증명은 반드시 개인 환경에서만 관리하세요.

위 항목을 모두 충족하면 별도의 수동 파일 교체 없이 바로 실행할 수 있습니다.
