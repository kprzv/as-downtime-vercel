# AS Downtime 3.10.5 — Vercel

Мобильное приложение для совместного выбора фильмов и сериалов.

## Публикация

1. Импортируйте этот репозиторий в Vercel.
2. Framework Preset: **Other**. Root Directory оставьте пустым.
3. Добавьте серверную переменную `TMDB_TOKEN` со значением TMDB API Read Access Token.
4. Нажмите Deploy.

Во время сборки Vercel скачивает проверенные SHA-256 файлы интерфейса AS Downtime 3.10.5, а серверные маршруты `/api` разворачиваются как Vercel Functions.

Проверка после публикации: `/api/health?deep=1`.
