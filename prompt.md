# SPOT AI 관리자용 모바일 대시보드 — Stitch 디자인 프롬프트

> Google Stitch에 입력할 프롬프트 모음입니다.
> **0. 공통 컨텍스트**를 먼저 넣어 프로젝트를 만들고, 이어서 **화면별 프롬프트(1~8)**를 한 화면씩 생성하는 방식을 권장합니다. 한 번에 여러 화면을 요청하면 Stitch가 세부 요소를 생략하는 경우가 많습니다.

---

## 왜 이 화면들이 필요한가 (제품 분석 요약)

지금까지 개발한 SPOT AI의 구조에서 관리자가 확인 · 조작해야 하는 지점을 뽑았습니다.

| 제품 구성 (소개 페이지 기준) | 관리자가 알아야 할 것 | 대시보드 화면 |
|---|---|---|
| 6단계 작동 사이클 (촬영 → 추론 → 교차 판정 → 펄스 급수 → 2차 피드백 → 로그) | 지금 어느 단계인지, 마지막 사이클 결과 | 1. 홈, 2. 디바이스 상세 |
| AI 추론 (MobileNetV3-Small Dry/Wet, 35% 기준, 신뢰도) + SEN0308 토양 수분 | AI 판정과 센서값이 일치하는지, 신뢰도 70% 미만 여부 | 2. 디바이스 상세 |
| 크로스 매트릭스 판정 (≤30% 건조만 급수, ≥60% 과습 차단) | 왜 급수했는지 / 왜 보류했는지 | 3. 급수 로그 |
| 5대 Fail-Safe (카메라 오류, 센서 고정값, 물통 고갈, 신뢰도 저하, 12초 펌프 상한) + Heartbeat 타임아웃 | 어떤 안전 장치가 언제 작동했는지 | 4. 알림 & Fail-Safe |
| Raspberry Pi 4 Docker Compose + MQTT (camera-agent, pico-bridge, mosquitto, ai-inference, control-orchestrator, web-api) + Pico | 어떤 서비스가 죽었는지, Pico 통신 상태 | 5. 시스템 상태 |
| 수동 분사 제어, 식물별 수분 프로파일, SEN0308 교정 곡선 | 안전하게 수동 조작 · 임계값 조정 | 6. 수동 제어, 7. 설정 & 교정 |
| 제품 데이터 수집 (이미지 + 실측 수분율, 경계 30~40%), ONNX 모델, OTA | 모델 버전, 경계 구간 데이터 확보량 | 8. AI 모델 & 데이터 |

---

## 0. 공통 컨텍스트 (프로젝트 첫 프롬프트)

```text
Design a mobile admin dashboard app (iOS/Android, 390×844) for "SPOT AI", an AI-powered smart plant care device.
All UI text must be in Korean (technical terms such as AI, Dry/Wet, MQTT, ONNX, Pico can stay in English).

[Product]
SPOT AI clamps onto a plant pot. A Raspberry Pi 4 captures soil images with a Camera Module 3 Wide under a 4000K LED,
classifies the soil as Dry or Wet with an on-device MobileNetV3-Small ONNX model (Dry = soil moisture ≤ 35%),
and cross-checks the result with a capacitive soil moisture sensor (DFRobot SEN0308) read by a Raspberry Pi Pico.
Only when both agree (moisture ≤ 30%) does it pulse-water 80 ml with a 12V peristaltic pump, wait 5 minutes,
then re-measure. A float switch detects an empty water tank. The Pico independently enforces safety:
pump cut-off on heartbeat timeout, empty tank, or 12-second continuous run limit.
Software on the Pi runs as Docker containers connected via an MQTT broker.

[Users]
Administrators / operators who manage several SPOT AI devices (one per pot) during a 14-day unattended MVP test.
They need to see at a glance whether every plant is safe, why the system watered or refused to water,
and whether any fail-safe has triggered.

[Design system — "Botanical Intelligence", keep consistent with the existing product website]
- Warm, calm, botanical, premium home-appliance feel. Light theme first.
- Background #FBF9F8, cards #FFFFFF, subtle containers #F5F3F3 / #EFEDED, text #1B1C1C, secondary text #50443E, borders #D4C3BB
- Primary (warm terracotta brown) #795743, primary container #FFD1B8
- Secondary #83533C, secondary container #FEBEA2
- Tertiary (sage green, used for "healthy/normal") #4C635F, tertiary container #C7E0DB
- Error #BA1A1A. Use amber for warnings. Water/moisture data can use a muted teal-blue accent.
- Font: Inter + Pretendard. Large bold numbers for KPIs, 14px body text.
- Icons: Material Symbols Rounded (potted_plant, water_drop, sensors, psychology, memory, developer_board, security, warning_amber, hub).
- Rounded cards (16px radius), soft shadows, generous spacing, 16px side margins.
- Status chips: 정상(sage green), 주의(amber), 위험(red), 오프라인(gray).

[Navigation]
Bottom tab bar with 5 tabs: 홈, 디바이스, 로그, 알림, 설정.
Top app bar shows the "SPOT AI" logo (potted_plant icon), a connection indicator ("로컬 Wi-Fi 연결됨"), and a notification bell with badge.
```

---

## 1. 홈 — 전체 현황 (Fleet Overview)

```text
Create the "홈" screen of the SPOT AI admin dashboard.

Top: greeting "관리자님, 오늘 식물 6개 중 5개가 정상이에요" and last sync time "방금 전 동기화".

Section 1 — System health hero card:
- A large status ring showing "정상 5 · 주의 1 · 위험 0 · 오프라인 0"
- Small line: "14일 무인 검증 · D+9 진행 중" with a progress bar (9/14)

Section 2 — KPI tiles in a 2×2 grid (big number + small label + tiny trend):
- "AI-센서 판정 일치율" 93.4% (target > 90%)
- "평균 사이클 시간" 7.4초 (target ≤ 10초)
- "오늘 총 급수량" 640 ml
- "Fail-Open 과급수" 0건 (shown with a shield icon, sage green)

Section 3 — "주의가 필요한 화분" alert card (amber):
- "거실 몬스테라 · 물통 수위 낮음 — 급수 후 10분간 수분 변화 없음" with a "확인하기" button

Section 4 — Device list "내 화분 디바이스":
Each row card shows: plant photo thumbnail, plant name ("거실 몬스테라", "침실 스킨답서스", "베란다 고무나무"...),
current soil moisture % with a small bar, latest AI result chip (Dry / Wet with confidence e.g. "Wet 94%"),
water tank icon (충분/부족), last watered time ("3시간 전 · 80ml"), and a status dot.

Section 5 — "최근 활동" mini timeline (3 items):
"14:02 침실 스킨답서스 급수 80ml 완료", "13:40 거실 몬스테라 급수 보류 (과습 60%↑)", "12:15 AI 신뢰도 68% → 센서값 추종".
```

## 2. 디바이스 상세 — 실시간 텔레메트리

```text
Create the "디바이스 상세" screen for one SPOT AI device ("거실 몬스테라", device ID SPOT-01).

Header: back arrow, plant name, status chip "정상", overflow menu. Subtitle: "Raspberry Pi 4 · Pico 연결됨 · 펌웨어 v2.4".

Card 1 — Latest soil capture:
- A soil photo with a dashed rectangle overlay labeled "Soil ROI 160×160"
- Caption: "4000K LED 촬영 · 2분 전" and a small "지금 촬영" button

Card 2 — Dual decision panel (two halves side by side, joined by a "교차 검증" badge in the middle):
- Left "비전 AI": large "Wet", confidence bar 94%, model "MobileNetV3-Small · ONNX"
- Right "토양 센서": large "42%", sensor "SEN0308 · 1.62V (교정 적용)"
- Below: result banner "판정 일치 — 급수 불필요" in sage green.
  (Design alternate states as well: amber "신뢰도 70% 미만 — 센서값만 추종", red "과습 60% 이상 — 급수 차단")

Card 3 — Soil moisture gauge: horizontal bar 0–100% with marked thresholds:
30% "급수 시작", 35% "AI Dry/Wet 경계", 60% "과습 차단". Current value pointer at 42%.

Card 4 — 24h moisture chart: smooth line chart of soil moisture over 24 hours,
with water drop markers where watering happened and a shaded band for 30–40% "경계 구간".
Segmented control: 24시간 / 7일 / 14일.

Card 5 — Hardware state grid (4 small tiles):
"물통 수위: 충분" (float switch), "펌프: 대기 (OFF)", "LED 조명: OFF", "Pico Heartbeat: 정상 · 1초 전".

Card 6 — 6-step cycle tracker: horizontal stepper
"촬영 → AI 추론 → 교차 판정 → 펄스 급수 → 2차 측정 → 기록", current step highlighted,
with elapsed time "2차 측정 대기 3:12 / 5:00".
```

## 3. 급수 로그 — 판정 이력

```text
Create the "로그" screen showing watering and decision history.

Top: filter chips "전체 · 급수 · 보류 · 차단 · 수동", device selector dropdown "모든 화분", date range "최근 7일".
Summary strip: "급수 18회 · 보류 41회 · 차단 2회 · 총 1,440ml".

Vertical timeline list grouped by date ("오늘", "어제"). Each log card shows:
- Time, plant name, outcome chip (급수 완료 = teal, 보류 = gray, 차단 = red, 수동 = brown)
- One-line reason, e.g. "AI Dry 88% + 센서 27% → 급수 결정", "AI 시듦 판정이나 센서 63% → 과습으로 급수 차단"
- Mini metrics row: AI result + confidence, soil moisture before → after (27% → 41%), dispensed volume (80ml in 4 pulses), cycle time 7.2s
- Small soil image thumbnail
- Monospace caption "command_id 7f3a…c21 · 만료 30초"

Tapping a card expands it to show the pulse sequence (4 × 12초 이하 펄스 bar visualization),
the 5-minute diffusion wait, and the secondary measurement result.
Include a "CSV 내보내기" text button at the top right.
```

## 4. 알림 & Fail-Safe 이벤트

```text
Create the "알림" screen focused on safety events.

Top card "Fail-Safe 방어 현황": 5 small icon badges in a row with counts for the last 7 days:
카메라 오류 (no_photography) 1, 센서 이상 (electric_meter) 0, 물통 고갈 (warning_amber) 2,
신뢰도 저하 (balance) 4, 펌프 12초 상한 (lock_clock) 0. Plus "통신 타임아웃 (Heartbeat)" 0.
Big reassurance line: "과급수(Fail-Open) 0건 — 모든 차단이 정상 작동했습니다".

Tabs: "미해결 2" / "해결됨" / "전체".

Alert list cards with severity color stripe on the left:
- 위험(red): "거실 몬스테라 · 물통 고갈 — 플로트 스위치 '물 없음', 펌프 구동 차단됨" with buttons "물 보충 완료" and "자세히"
- 주의(amber): "침실 스킨답서스 · 카메라 촬영 3회 실패 → 토양 센서 단독 루틴으로 전환"
- 주의(amber): "AI 신뢰도 64% (< 70%) → 센서 기준값만 추종"
- 정보(gray): "ai-inference 컨테이너 재시작됨 (Healthcheck 실패 1회)"
Each card shows time, device name, which component made the decision ("Pico 펌웨어 차단" vs "SBC 판단"), and an acknowledge checkbox.

Bottom: "알림 설정" link (push for 위험 only / 위험+주의 / 전체).
```

## 5. 시스템 상태 — SBC · MCU 진단

```text
Create the "시스템 상태" screen (reached from the 디바이스 tab) that shows the health of the SBC software and the MCU for one device.

Card 1 — Device overview: "Raspberry Pi 4 Model B (4GB) · Raspberry Pi OS 64-bit", uptime "12일 4시간",
CPU temperature gauge 54°C, CPU 23%, RAM 1.1/4GB, storage 38%.

Card 2 — Service list titled "서비스 (Docker Compose + Host)", each row with icon, name, role, status dot, and restart count:
- camera-agent (Host · systemd) — 이미지 촬영 — 정상
- pico-bridge (Host · systemd) — Pico USB Serial ↔ MQTT — 정상
- mosquitto (Docker) — MQTT Broker :1883 — 정상
- ai-inference (Docker) — Dry/Wet 추론 · 평균 2.1초 — 정상, 재시작 1회
- control-orchestrator (Docker) — 교차 검증 · 급수 판단 — 정상
- web-api (Docker) — Flask 대시보드 — 정상
Each row has a small "재시작" icon button.

Card 3 — MQTT topic monitor: compact list of topics with last message age and rate:
spot/camera/frame, spot/ai/soil, spot/sensor/soil, spot/sensor/tank, spot/pump/cmd, spot/pump/state, spot/system/state.

Card 4 — Raspberry Pi Pico (RP2040): "USB CDC Serial 연결됨", heartbeat sparkline, safety interlock checklist with check icons:
"통신 타임아웃 시 펌프 OFF", "물통 고갈 시 구동 차단", "연속 구동 12초 상한", "부팅 중 제어핀 LOW".

Card 5 — Power: "12V 주전원 정상 · 5V 강압 정상" with small icons.
```

## 6. 수동 제어

```text
Create the "수동 제어" screen for one device (opened from the device detail).

Warning banner at top (amber, outlined): "수동 제어 중에도 Pico 안전 인터록은 항상 동작합니다".

Card 1 — Manual watering:
- Volume stepper (20ml / 40ml / 80ml) and a note "최대 유량 100mL/min · 1회 연속 구동 최대 12초 → 80ml는 4회 펄스로 분할"
- Big primary button "수동 급수 시작" (terracotta). Disabled state with reason when tank is empty: "물통이 비어 급수할 수 없습니다".
- Show a confirmation bottom sheet design: "거실 몬스테라에 80ml 급수할까요? 현재 토양 수분 42% (과습 기준 60%)" with 취소 / 급수 buttons.
- In-progress state: circular progress "펄스 2/4 · 8초 남음" with a red "긴급 정지" button.

Card 2 — Quick actions grid: "지금 촬영", "LED 조명 테스트", "센서 재측정", "자동 급수 일시정지" (toggle).

Card 3 — Recent manual actions list (3 rows) with time and who performed it.
```

## 7. 설정 & 센서 교정

```text
Create the "설정" screen for device configuration.

Section "식물 프로파일":
- Plant name, species dropdown (몬스테라, 스킨답서스, 고무나무 ...), photo.
- Segmented control for moisture profile: 건조 / 보통 / 다습.
- Threshold sliders with values: "급수 시작 수분율 30%", "과습 차단 수분율 60%", "AI 신뢰도 하한 70%".
- Watering settings: "1회 급수량 80ml", "확산 대기 5분", "펌프 연속 구동 상한 12초 (펌웨어 고정, 잠금 아이콘)".

Section "토양 센서 교정 (SEN0308)":
- Explanation: "센서 출력은 전압입니다. 교정 후에만 수분율(%)로 표시됩니다."
- Two-point calibration cards: "건조 기준 2.45V" and "포화 기준 1.12V", each with a "지금 측정" button.
- Small calibration curve chart (voltage on X, moisture % on Y) and status chip "교정 완료 · 10월 20일".

Section "촬영":
- "촬영 주기 30분", "LED 4000K 보조조명 사용" toggle, "Soil ROI 위치 조정" row with a preview thumbnail.

Section "네트워크 & 기기": local Wi-Fi name, device IP, "OTA 펌웨어 업데이트 v2.5 사용 가능" with an update button,
and a destructive "디바이스 초기화" row in red at the bottom.
```

## 8. AI 모델 & 데이터 수집

```text
Create the "AI 모델 & 데이터" screen (reached from 설정).

Card 1 — Deployed model:
"MobileNetV3-Small · Dry/Wet · soil_moisture_v3.onnx", runtime "ONNX Runtime · ARM64",
metrics row: 평균 추론 2.1초, 모델 크기 4.2MB, Peak 메모리 180MB.
Chip "Keras ↔ ONNX 출력 검증 통과".

Card 2 — Live accuracy vs sensor (field validation):
- Big number "AI-센서 일치율 93.4%"
- 2×2 confusion matrix (Actual Dry/Wet × Predicted Dry/Wet) with labels "급수 누락 위험" (Dry→Wet) and "과습 위험" (Wet→Dry) in the error cells
- Separate stat "경계 구간 30~40% 정확도 84%"
- Confidence distribution histogram with the 70% threshold line.

Card 3 — Product dataset collection:
- Progress "수집 이미지 1,240장 / 목표 3,000장"
- Bar chart of samples by moisture bucket, with 30–40% boundary buckets highlighted and a hint "경계 구간 데이터 부족 — 34~36% 추가 수집 필요"
- Rows: "pot_id 기준 Group Split 화분 수 12개", "라벨 기준 ≤35% Dry / >35% Wet".
- Button "데이터 내보내기".

Card 4 — Model update: "새 모델 v4 검증 대기" with a stepper "독립 Test → ONNX 변환 → 출력 비교 → Edge 테스트" and a disabled "배포" button until all steps pass.
```

---

## 사용 팁

- **디자인 일관성**: 첫 화면이 마음에 들면 Stitch의 테마/디자인 시스템을 고정한 뒤 나머지 화면을 생성하세요. 색상 코드는 `css/style.css`의 Stitch 토큰과 같으므로, 기존 소개 페이지와 같은 톤으로 나옵니다.
- **상태 변형**: 2번(판정 패널), 6번(급수 버튼)은 정상/주의/위험 상태를 `generate variants`로 따로 뽑아 두면 실제 구현 때 유용합니다.
- **다크 모드**: 야간 점검용이 필요하면 "Create a dark mode version of this screen keeping the same layout" 프롬프트를 추가하세요.
- **수치는 예시**입니다. 일치율 93.4%, 사이클 7.4초 등은 소개 페이지 KPI를 바탕으로 한 목업 값이며, 실제 MQTT 토픽(`spot/...`) 데이터에 연결할 때 교체합니다.
