# 프로젝트: TempoWeb — 음악 속도/피치 변환 모바일 웹앱

## 제품 한 줄 정의
휴대폰 브라우저에서 로컬 음악 파일을 불러와 속도와 음정을 독립 조절하고, A-B 반복, 마커, EQ, 효과, BPM/키 분석, 녹음, 내보내기를 제공하는 음악 연습 도구.

## 확정 기술 스택
- Vite + React 18 + TypeScript(strict) + Tailwind CSS
- 상태관리: Zustand
- 오디오 엔진: signalsmith-stretch Web Audio/WASM
- 파형: wavesurfer.js v7, 표시와 터치 입력 전용
- 저장: IndexedDB(idb)
- 인코딩: WAV 직접 인코딩, MP3는 @breezystack/lamejs 지연 로딩
- PWA: vite-plugin-pwa

## 아키텍처 대원칙
1. 소리 경로는 하나로 유지한다.
2. wavesurfer는 소리를 내지 않고 파형 표시와 탐색 이벤트만 담당한다.
3. 시간 기준은 오디오 엔진 하나로 통일한다.
4. 모든 처리는 브라우저 안에서 끝내며 서버 업로드는 없다.
5. 무거운 작업은 Worker로 분리한다.
6. 파라미터 변경에는 smoothing을 적용해 틱/팝을 줄인다.
7. 꺼진 효과는 우회하거나 wet gain을 0으로 둔다.
8. iOS 대응을 위해 재생은 사용자 터치 이후 AudioContext resume으로 시작한다.
9. 모바일 우선: 390px 기준, 터치 타깃 44px 이상, 다크 테마 기본.

## 오디오 그래프
디코딩된 소스 또는 Signalsmith Stretch 버퍼 -> 프리앰프 -> 밸런스 -> EQ -> 다이내믹스 -> 에코/플랜저/리버브 -> 모노 -> Analyser -> MediaStreamDestination -> 숨김 audio 엘리먼트 -> 스피커.

## 핵심 공식
```txt
tempoFactor = tempoPercent / 100
pitchRatio  = 2 ^ (pitchSemitones / 12)
rate mode semitones = 12 * log2(ratePercent / 100)
adjustedBpm = originalBpm * tempoFactor
barSeconds = 60 / BPM * beats
```

## UI 정보 구조
- 하단 탭: 라이브러리 / 플레이어 / 큐 / 설정
- 모든 탭 하단에 미니플레이어 고정
- 플레이어: 곡 정보, 파형, 트랜스포트, 속도/음정, 루프/마커, EQ/효과/분석/저장 시트
- 패널은 bottom sheet로 통일
- 문구는 한국어, 톤은 어두운 스튜디오 장비 느낌

## 품질 게이트
- TypeScript strict와 빌드 통과
- 390px 폭에서 가로 스크롤 없음
- 오류/빈 상태 UI 존재
- 로컬 파일은 업로드하지 않음
- 원본 앱 이름, 로고, 문구, 그래픽 복제 금지
