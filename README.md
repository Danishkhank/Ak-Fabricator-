# AK Fabricator - Team Ledger

Ghanshyam Chauhan ki shop ke liye hisaab, chhutti, kaam aur payment request ka system.

## Files
- `index.html` - page ka dhancha
- `css/style.css` - design (luxury dark theme)
- `js/config.js` - **sirf yahan settings badlein** (Firebase config, owner email, phone, map link)
- `js/app.js` - poora logic (login, owner/worker screens, hisaab ki ganit, WhatsApp, CSV)
- `database.rules.json` - Firebase security rules

## Setup (ek baar)
1. Firebase Console -> Authentication -> Sign-in method -> **Email/Password ON**.
2. Authentication -> Users -> **Add user**: email `cghanshyam787@gmail.com` aur apna password. (Password sirf yahin rakhein, kisi file mein nahi.)
3. Realtime Database -> Rules -> `database.rules.json` ka poora text paste -> **Publish**.
4. Authentication -> Settings -> Authorized domains -> `aapkaname.github.io` jodein.
5. GitHub par naya repository banayein, saari files (folders ke saath) upload karein.
6. Repository -> Settings -> Pages -> Branch `main` / root -> Save. Kuch minute mein link mil jayega.

## Workers kaise jodein
Owner login karke **Team -> + Worker** dabaye: naam, role, phone, salary, email, password. Worker usi email-password se login karega aur sirf apna hisaab dekhega.

## Hisaab ka formula
Ek din ka rate = salary / mahine ke din. Katauti = rate x bina-paid chhutti. Payable = salary - katauti. Baaki = payable - diye gaye paise.
