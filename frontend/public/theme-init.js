// Aplica el tema guardado antes de pintar (evita el parpadeo). Va en un archivo propio, no en línea,
// porque la política de seguridad (CSP) del servidor no permite scripts en línea.
try { var t = localStorage.getItem('crm-theme'); if (t) document.documentElement.dataset.theme = t } catch (e) { /* sin storage */ }
