BREW & BITE  –  Café Billing System  (React.js + native Node.js HTTP + MySQL)

1) BACKEND  (folder: backend-node)
   - Copy .env.example to .env and fill DB_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET
   - npm install
   - npm start          -> http://localhost:5000/api/health
   All tables (bb_*) are created automatically. Your existing `categories` and `products`
   tables and data are kept (new columns are added). 24 tables (T1..T24) are added on first run.

2) FRONTEND (folder: frontend)
   - npm install
   - npm start          -> http://localhost:3000   (public POS, no login)
   - Admin / staff login -> http://localhost:3000/admin-login

Public POS  : /  /orders  /tables  /menu  /customers  /reports (today only)
Admin panel : /admin-dashboard  /admin/orders  /admin/tables  /admin/menu  /admin/categories
              /admin/customers  /admin/reports  /admin/reports/:name  /admin/expenses
              /admin/taxes  /admin/users  /admin/audit  /admin/notifications  /admin/settings
