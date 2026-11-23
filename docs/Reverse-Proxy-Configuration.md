# 🔒 Reverse Proxy Configuration (Nginx Proxy Manager / Nginx)

`localhost:5001` 처럼 포트 번호를 입력하고 들어가는 대신, 도메인 주소(예: `https://zkzzk.mydomain.com`)를 통해서 보안(HTTPS)을 적용하여 접속하고 싶을 때 사용하는 리버스 프록시 설정 방법입니다.

---

## 🟢 Nginx Proxy Manager 사용하기 (추천)

Nginx Proxy Manager(NPM)는 복잡한 텍스트 파일 설정 없이 **깔끔한 웹 UI 화면에서 클릭 몇 번만으로 무료 SSL 인증서(HTTPS)를 발급받고 도메인을 연결해주는 매우 편리한 도구**입니다. 초보자분들께 적극 권장합니다.

**1. Nginx Proxy Manager 설치**
보통 Docker를 이용하여 쉽게 설치할 수 있습니다. 자세한 설치 방법은 [공식 홈페이지 가이드](https://nginxproxymanager.com/setup/)를 참고하세요.

**2. 관리자 웹 UI 접속**
설치가 완료되면 NPM의 관리자 페이지(보통 `http://서버IP:81`)로 접속하여 로그인합니다.

**3. Proxy Host 추가**
1. 상단 메뉴에서 **Hosts** -> **Proxy Hosts** 메뉴로 들어갑니다.
2. 우측 상단의 **[Add Proxy Host]** 버튼을 클릭합니다.
3. **Details 탭**에 다음과 같이 입력합니다:
   - **Domain Names**: 본인의 도메인 주소 (예: `zkzzk.mydomain.com`)
   - **Scheme**: `http`
   - **Forward Hostname / IP**: zkzzk가 설치된 서버의 내부 IP 주소 (도커를 같이 쓰고 있다면 도커 내부망 IP 또는 호스트 IP 주소를 입력하세요.)
   - **Forward Port**: `5001`
   - **Block Common Exploits** 및 **Websockets Support** 옵션을 모두 켜줍니다(스위치 ON).

**4. SSL(HTTPS) 인증서 자동 발급**
1. 같은 창의 **SSL 탭**으로 이동합니다.
2. **SSL Certificate** 항목의 드롭다운을 눌러 `Request a new SSL Certificate`를 선택합니다.
3. **Force SSL**과 **HTTP/2 Support** 옵션을 켜줍니다.
4. 본인의 이메일 주소를 입력하고, Let's Encrypt 이용 약관 동의(I Agree...)에 체크합니다.
5. **[Save]** 버튼을 누르면 잠시 후 인증서 발급과 함께 도메인 연결이 완료됩니다!

이제 `https://zkzzk.mydomain.com` 으로 접속하면 자물쇠 아이콘이 표시된 안전한 연결로 zkzzk를 사용할 수 있습니다!

---

## 🔵 Nginx 직접 설정하기 (수동)

만약 터미널 환경이 익숙하고 Nginx 설정 파일을 직접 다루고 싶다면 아래 예시를 참고하세요.

**Nginx 설정 파일 (`/etc/nginx/sites-available/zkzzk`)**

```nginx
server {
    listen 80;
    server_name zkzzk.mydomain.com; # 본인의 도메인으로 변경하세요

    location / {
        proxy_pass http://localhost:5001; # zkzzk 서버 포트
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # 실시간 진행률 알림(SSE)을 지연 없이 전달하기 위한 설정
        proxy_buffering off;

        # 큰 영상 파일을 문제 없이 업로드/다운로드 하기 위한 설정
        client_max_body_size 50000M;
    }
}
```

> [!NOTE]
> 위 설정은 HTTP 전용 설정입니다. HTTPS 설정을 원하신다면 **Certbot (Let's Encrypt)** 등을 이용하여 인증서를 발급받고 적용해야 합니다. 터미널에 `sudo certbot --nginx -d zkzzk.mydomain.com` 명령어를 입력하면 손쉽게 SSL을 적용할 수 있습니다.
