CHIPSET V18

Changes:
1. Customer dashboard withdrawal line ONLY shows withdrawal schedule:
   - Daily -> Withdrawal: Daily • Available now / Next available: DATE
   - Weekly -> Withdrawal: Weekly • Available now / Next available: DATE
   - Monthly -> Withdrawal: Monthly • Available now / Next available: DATE
2. Removed matured principal / earnings / principal breakdown from that dashboard status line.
3. Admin customer withdrawal schedule choices are Daily, Weekly (Default), Monthly.
4. SOA download is now PDF using jsPDF; detailed SOA viewer remains available.
5. No new SQL is required for these V18 frontend changes. Keep existing V15/V16/V17 SQL already applied.
6. Do NOT rerun daily earning SQL.

After replacing the chip folder, hard refresh with Ctrl+Shift+R.
