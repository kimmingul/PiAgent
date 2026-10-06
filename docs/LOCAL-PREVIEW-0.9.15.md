# 0.9.15 미서명 로컬 설치

2026-10-06 11:34 KST, 사용자 요청으로 이 Windows ARM64 PC에 설치했다.
공개 GitHub 서명 릴리즈는 0.9.14이며 이 파일은 로컬 테스트 설치본이다.

- 파일: `dist/PiAgent-Setup-0.9.15-unsigned-preview.exe`
- SHA256: `0ac54f4c9e0930258aa6692e8bd95937c5055390745439a6a72aadff490be461`
- Authenticode: `NotSigned`
- 설치 release: `%LOCALAPPDATA%\Programs\PiAgent\releases\0.9.15-20261006023248`
- 등록 업데이트: VS2022/2026, RAD13.2 32/64-bit.
- 실행 Core: 0.9.15, ARM64 Node 24.21.0. 인증 handshake와 ping/pong 통과.

기존 Core 설정과 저장 대화를 유지했으며 기존 OMP를 재사용했다. IDE 종료 및 OMP 작업 부재를
확인한 뒤 이전 설치 Core만 종료하고 업데이트했다. 새 Core는 숨김 실행 상태다.
설치된 VS UI의 bridge/controller/git 파일은 빌드본과 SHA256이 일치한다.
RAD 양쪽 Known Packages는 새 release의 BPL을 가리킨다.
내장 payload 해시 검증 및 ARM64/x64 런타임 인증 연결 테스트를 통과했다.
Windows 앱 목록 DisplayVersion도 0.9.15로 확인했다.

이는 설치·등록·Core 연결 검증이다. 사용자 프로젝트의 agentic coding 실사용 결과나
VS2022/RAD32 전수 UI 검증 완료를 의미하지 않는다. 기존 134개 회귀, adapter 통합 15개,
실제 패키지 WebView 67개 검증은 [개발 릴리즈 기록](RELEASE-0.9.15.md)에 기록했다.

미서명 빌드 명령: `./scripts/build-installer.ps1 -NoSign`.
이 빌드에서는 USB 인증서나 PIN을 사용하지 않는다.
