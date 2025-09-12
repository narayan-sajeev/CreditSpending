# Spending Dashboard

A lightweight, browser-based dashboard for visualizing personal spending data from CSV files. Built with **Bootstrap 5**, **Chart.js**, and **DataTables**.

## Features

* 📂 **CSV Upload**: Load transaction data directly into the dashboard.
* 📊 **KPIs**: View total spend, transaction count, average transaction size, and top merchant.
* 📈 **Charts**:

  * Spend Over Time (line chart)
  * Spend by Category (pie chart)
  * Top Merchants (bar chart)
* 🔎 **Filters**: Filter by date range, category, and merchant.
* 📋 **Transactions Table**: Interactive, searchable, and sortable.

## Tech Stack

* **Frontend**: HTML, CSS, JavaScript
* **Frameworks/Libraries**:

  * [Bootstrap 5](https://getbootstrap.com/)
  * [Bootstrap Icons](https://icons.getbootstrap.com/)
  * [Chart.js](https://www.chartjs.org/)
  * [PapaParse](https://www.papaparse.com/)
  * [DataTables](https://datatables.net/)

## Usage

1. Open `index.html` in a web browser.
2. Upload a `.csv` file containing transactions.
3. Explore the dashboard: filter by category/merchant/date, analyze KPIs, and review transactions.

## File Overview

* `index.html` — Main HTML structure for the dashboard.
* `styles.css` — Custom styles for visual polish.
* `app.js` — Core logic for parsing CSVs, filtering data, and rendering charts/tables.