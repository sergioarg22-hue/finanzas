// ── GMAIL OAUTH: Paso 1 - redirigir a Google para autorizar ──────────────────
// GET /api/gmail-auth?user=Sergio  (o ?user=Vane)
// El usuario hace clic en "Conectar Gmail" en la app, que apunta acá con su nombre.
// El nombre viaja en el parámetro "state" de OAuth y vuelve en el callback,
// así sabemos de quién es cada cuenta conectada.

module.exports = async (req, res) => {
  const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
  const REDIRECT_URI = 'https://agaete.vercel.app/api/gmail-callback';
  const user = (req.query && req.query.user) || 'Desconocido';

  if (!CLIENT_ID) {
    return res.status(500).send('Falta configurar GMAIL_CLIENT_ID en las variables de entorno.');
  }

  const scope = encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly');
  const state = encodeURIComponent(user);
  const url =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${scope}` +
    `&access_type=offline` +
    `&prompt=consent` +
    `&state=${state}`;

  res.writeHead(302, { Location: url });
  res.end();
};
