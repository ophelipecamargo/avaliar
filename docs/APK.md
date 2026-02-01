# Avaliar (APK)

Este projeto esta configurado para gerar APK via Capacitor.
A versao mobile abre diretamente o login (tela inicial do app).

## Como gerar o APK (Android)

1) Instale o Android Studio e o Android SDK (se ainda nao tiver).
2) No terminal, sincronize o projeto Android:
   npx cap sync android
3) Abra o Android Studio:
   npx cap open android
4) No Android Studio:
   - Build > Build Bundle(s) / APK(s) > Build APK(s)

O APK gerado fica em:
android/app/build/outputs/apk/debug/app-debug.apk

## Observacoes
- Como o servidor usa IP fixo e HTTP, o Capacitor esta com cleartext habilitado.
- Para mudar a URL do servidor:
  1) Atualize APP_SERVER_URL no .env
  2) Rode: npm run cap:update-url
  3) Rode: npx cap sync android
- A tela inicial do app e o login (o servidor controla a rota).
- O app segue a mesma regra do desktop para selecao de ano (lista de anos vem do servidor).

## Icone
Use a logo em public/assets/logo-avaliar.svg para gerar os icones Android.
Se quiser, posso gerar os icones para voce.
