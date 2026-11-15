# Saper dla dwóch

Retro, pixelowa gra online dla 2 graczy (muzyka 8-bit generowana w przeglądarce). Serwer w Node.js **bez zewnętrznych zależności** (nie trzeba `npm install`).

## Uruchomienie lokalnie

```bash
node server.js
```

Otwórz `http://localhost:3000` w dwóch kartach (każda karta = osobny gracz).

## Zasady (skrót)

- Gracze podają imię. Pierwszy wybiera rozmiar planszy (10×10 = 10 bomb, 15×15 = 22, 20×20 = 40) i rozpoczyna grę; drugi dołącza. Max 2 graczy naraz.
- Każdy ustawia bomby na własnej planszy. Gdy pierwszy skończy, drugi ma 15 s (brakujące bomby zostaną dolosowane).
- Lewa strona ekranu: Twoja plansza i ruchy przeciwnika. Prawa: plansza przeciwnika z jego imieniem nad nią — tu szukasz bomb.
- Gra jest równoczesna, bez tur: każdy gra we własnym tempie. LPM = odkryj pole, PPM = flaga (flag jest tyle, ile bomb).
- Runda kończy się, gdy ktoś trafi na bombę (przegrywa) albo jako pierwszy oflaguje poprawnie wszystkie bomby przeciwnika / odkryje wszystkie bezpieczne pola (wygrywa).
- Kto pierwszy wygra 2 rundy, wygrywa grę — zwycięzca dostaje fajerwerki.

## Hosting za darmo — rekomendacja: Render.com

Gra potrzebuje serwera Node (stan gry jest w pamięci), więc nie nadaje się do hostingu statycznego (GitHub Pages, Netlify).

1. Wrzuć folder na GitHub (repozytorium, może być prywatne).
2. Załóż konto na https://render.com → **New → Web Service** → wybierz repo.
3. Ustawienia: Runtime **Node**, Build Command puste (lub `echo ok`), Start Command `node server.js`, plan **Free**.
4. Po wdrożeniu dostaniesz adres `https://twoja-nazwa.onrender.com` — wyślij go synowi i kolegom.

Uwagi:
- Darmowy plan „usypia” serwis po ok. 15 min bez ruchu; pierwsze wejście po przerwie trwa ok. minuty. Można to złagodzić darmowym pingiem (np. UptimeRobot co 5 min na ten adres).
- Gra działa jako jedna instancja (jeden pokój) — tak ma być, wg specyfikacji.
- Warunki darmowych planów się zmieniają — sprawdź aktualną ofertę. Alternatywy: Koyeb, Fly.io (wymaga karty).
- Do szybkiego grania „na dziś” bez hostingu: uruchom `node server.js` i udostępnij port tunelem (Cloudflare Tunnel `cloudflared tunnel --url http://localhost:3000` lub ngrok).
"# Saperek" 
