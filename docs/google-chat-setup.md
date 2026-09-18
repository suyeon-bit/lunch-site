# Google Chat 링크 미리보기 설정

이 코드는 Google Chat 앱의 HTTP 요청을 받을 준비가 된 상태입니다. Google Cloud 및 회사 Workspace 설정은 계정 소유자가 직접 해야 합니다.

## 이 버전에서 되는 일

- `https://lunch-site.suyeon-974.workers.dev/?room=<12자리 ID>` 링크가 Chat에 올라오면 D1에서 **그 모임의 현재 내용**을 읽어 카드로 표시합니다.
- 참여 인원, 모임 유형에 맞는 상위 날짜 또는 식당 후보, 확정 여부를 표시합니다. 현재 DB는 **식당 모임과 날짜 모임이 별개**이므로 한 카드에 두 투표를 동시에 표시할 수 없습니다.
- `참여하기`, `날짜 투표` 또는 `식당 투표`, `전체 결과 보기`는 해당 웹 화면을 엽니다. `결과 새로고침`은 카드를 클릭할 때 D1을 다시 읽어 카드 내용을 갱신합니다.
- 모임 없는 홈페이지 링크는 일반 안내 카드, 없는 모임 ID는 오류 안내 카드가 됩니다.
- 링크 게시 이후 투표가 변경되어도 카드는 자동 갱신되지 않습니다. Chat의 사용자 게시 메시지에 붙은 미리보기는 카드 클릭 시에만 갱신할 수 있습니다.
- Chat에서는 출석 등록이나 투표 값을 직접 저장하지 않습니다. 기존 웹 참여자 수정은 브라우저별 편집 토큰에 묶여 있기 때문입니다. 사이트 버튼으로 이동하여 기존 권한 구조를 그대로 사용합니다.

## 계정 소유자가 설정할 순서

1. 회사 Google Workspace 계정에서 새 Google Cloud 프로젝트를 만듭니다. 회사 정책상 프로젝트 생성이 막혀 있으면 관리자에게 생성 또는 권한 부여를 요청합니다.
2. Google Cloud Console에서 **Google Chat API**를 사용 설정합니다. Chat API **Configuration**으로 이동합니다. 필요한 경우 OAuth 동의 화면의 기본 정보도 구성합니다.
3. 앱 이름, 설명, 공개 HTTPS 아바타 URL을 입력하고 **Interactive features**를 켭니다.
4. **Connection settings**에서 **HTTP endpoint URL**을 선택하고 모든 트리거에 공통 URL을 사용하도록 설정합니다. URL에는 `https://lunch-site.suyeon-974.workers.dev/api/chat`을 넣습니다.
5. **Authentication Audience**는 **HTTP endpoint URL**로 지정합니다. **Project Number**를 선택하면 이 코드가 요청을 401로 거절합니다. URL의 경로와 끝 슬래시도 정확히 맞아야 합니다.
6. **Link previews**에서 URL 패턴을 추가합니다. **Host pattern**: `lunch-site.suyeon-974.workers.dev`; **Path prefix**: 빈칸. `room`은 URL의 쿼리 파라미터이므로 패턴에 쓰지 않습니다. 같은 호스트의 일반 홈페이지 링크도 이 패턴에 포함됩니다.
7. 테스트할 본인 및 동료를 **Visibility**의 특정 사용자/그룹에 추가하고 저장합니다. 먼저 본인만 등록해 동작을 확인합니다.
8. Google Chat에서 앱을 찾아 테스트용 채팅방/스페이스에 추가합니다. 회사 설정이 앱 추가를 막으면 Workspace 관리자에게 해당 Chat 앱의 사용과 설치 허용을 요청합니다. 링크 미리보기는 앱이 들어간 채팅방에서만 생성됩니다.
9. 기존 사이트에서 모임을 만들고 공유 링크를 Chat에 붙여넣습니다. URL은 반드시 `https://`로 시작해야 합니다.

## `/점심` 명령어 추가

기존 Google Chat API **Configuration → Commands → Add a command**에서 아래 값을 입력하고 저장합니다. 기존 **Connection settings**의 공통 HTTP endpoint URL은 그대로 `/api/chat`을 사용합니다.

| 설정 항목 | 입력값 |
| --- | --- |
| 명령어 유형 | Slash command |
| Slash command name | `/점심` |
| Description | `점약 만들기, 식당·날짜 정하기, 정산 메뉴 열기` |
| Command ID | `731` |
| Open a dialog | 선택하지 않음 |

Command ID는 사용자가 입력하는 숫자가 아니라 Google Chat이 앱에 전달하는 내부 명령 식별자입니다. 사용자가 채팅에 `731`을 입력해도 이 명령이 실행되지는 않습니다. `731`번 ID를 다른 명령에 이미 사용했다면 그 명령과 충돌하므로 기존 ID를 확인하세요. 이 코드의 `LUNCH_COMMAND_ID`는 `731`입니다. `/점심`은 명령 ID로 인식하며, 문자열이 포함된 일반 메시지는 명령으로 취급하지 않습니다. 명령에 대한 카드는 호출한 사용자에게만 표시하고, 네 버튼은 사이트의 기능 탭을 엽니다. [Google Chat 명령어 설정 문서](https://developers.google.com/workspace/chat/commands)를 참고하세요.

Cloudflare에서 별도 Secret이나 D1 migration은 필요하지 않습니다. Google은 Chat 요청에 서명된 ID 토큰을 첨부하고 Worker가 Google 공개키, 발급자, 정확한 엔드포인트 대상, `chat@system.gserviceaccount.com` 이메일과 만료 시간을 검증합니다. 토큰 없이 `/api/chat`을 호출하면 401입니다. GitHub에 인증 비밀을 저장하지 않습니다.

## 설치 및 관리자 승인

- 회사 정책이 앱 설치를 허용하고 본인이 Chat 앱 설정 권한을 갖고 있다면 테스트 사용자 지정 후 직접 추가할 수 있습니다.
- 회사 관리자가 Chat 앱, 외부 앱, Cloud 프로젝트 생성 또는 Marketplace 사용을 제한했다면 **관리자 허용이 필요**합니다. 일반 사용자만으로 가능한지는 회사 설정에 따라 다르므로 이 저장소에서 확인할 수 없습니다.
- 테스트 대상 외의 조직 전체에 배포할 때는 Google Workspace Marketplace 비공개 게시 또는 관리자 배포 정책이 추가로 필요할 수 있습니다. 이 단계는 회사 관리자와 상의하세요.

## 확인 순서

1. `npm test`와 `npx wrangler deploy --dry-run`을 실행합니다.
2. 일반 웹사이트에서 식당 목록, 점약 만들기/참여/투표, 정산이 기존처럼 되는지 확인합니다.
3. 앱을 추가한 Chat 공간에서 홈페이지 링크를 올려 안내 카드가 뜨는지 확인합니다.
4. 존재하는 식당/날짜 모임 링크를 각각 올려 참여 인원과 후보가 D1과 같은지 확인합니다.
5. 존재하지 않는 12자리 `room` 링크를 올려 오류 안내 카드가 뜨는지 확인합니다.
6. 0명 모임, 여러 명 모임, 날짜 투표, 식당 투표를 순서대로 확인합니다.
7. 웹사이트에서 투표를 바꾼 뒤 Chat 카드의 `결과 새로고침`을 눌러 최신 결과를 확인합니다.
8. Google Chat PC와 모바일에서 카드, 버튼, 사이트 이동을 각각 확인합니다. 이 마지막 실제 Chat 테스트는 Google Cloud 앱 등록 및 회사 설치 허용 후에만 가능합니다.
9. Chat에서 `/점심`을 실행해 네 버튼과 이동할 탭을 확인합니다. 식당·날짜 버튼은 함께 정하기 화면의 종류 선택값도 설정해야 합니다.

공식 참고: [Chat 링크 미리보기](https://developers.google.com/workspace/chat/preview-links), [Chat 요청 검증](https://developers.google.com/workspace/chat/verify-requests-from-chat), [테스터 설정](https://developers.google.com/workspace/chat/test-interactive-features).
