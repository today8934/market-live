# 마켓 모니터

한국·미국 지수, 선물, 유가, VIX와 미국 10년 국채금리 등 12개 항목을 한 화면에서 확인합니다.

페이지: https://today8934.github.io/market-live/

## 갱신 방식

- 11개 지표: 페이지를 열어 두면 시세 중계 서버에 60초마다 직접 조회합니다. 새로고침 버튼도 중계 서버를 조회하며 GitHub 예약 실행을 기다리지 않습니다. 중복 조회 결과는 최대 60초간 공유합니다.
- 시세 중계: https://market-live-feed-8934.silverpearl6.chatgpt.site/api/quotes?v=2 (공개 시세 전용, 읽기 전용). 서버 소스는 Sites 프로젝트 appgprj_6ae9dd91a7288191a30793770c26a903에서 관리합니다.
- GitHub Actions의 수집·배포는 첫 화면에 표시할 저장 시세와 페이지 변경 배포용입니다. 예약이 늦어져도 열린 페이지의 직접 조회는 계속됩니다.
- US TECH 100: FOREX.com 나스닥100 현금 CFD의 TradingView 공식 위젯입니다. 위젯이 자체 갱신하며 다른 제공처의 US TECH 100 가격과 다를 수 있습니다.
- 무료 공개 시세에는 공급자 지연이 있습니다. 60초마다 조회해도 초 단위 실시간 서비스가 되지는 않습니다.
- 상단 수집 시각과 카드별 시세 기준 시각을 구분하여 한국시간으로 표시합니다.
- 수집 실패 시 이전 값과 원래 시각을 유지합니다. 수집이 3분 이상 멈추면 장 마감 상태 대신 갱신 지연을 표시합니다. 전체 수집 실패 시 기존 배포를 보존합니다.
- GitHub는 공개 저장소에서 60일간 활동이 없으면 예약 작업을 중지할 수 있습니다. Actions의 실행 기록을 확인하고 필요 시 Enable workflow를 실행하세요.

## 데이터

Yahoo Finance: 코스피, 코스닥, 나스닥 종합, S&P 500, 필라델피아 반도체 지수(SOX), 나스닥100 선물, VIX, Cboe TNX 수익률, WTI·브렌트 최근월물.

KRED: 코스피200 야간선물. 주간 종가 대비 참고 시세이며 거래소 확정 종가와 다를 수 있습니다.

국채금리는 % 단위, 변화는 %p와 bp로 표시합니다. 나스닥 종합·나스닥100 선물·US TECH 100 CFD를 구분합니다.

## 개발

Node.js 22 이상. 별도 패키지와 API 키가 필요하지 않습니다.

```text
node --test collect.test.mjs
node collect.mjs
```

화면 수정: index.template.html. 수집·생성: collect.mjs. 결과: site/index.html 및 site/quotes.json.

GitHub Settings → Pages → Source는 GitHub Actions로 설정합니다.
