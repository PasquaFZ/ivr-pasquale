function langFrom(req) {
  if (req.query.lang === "es") return "es";
  if (req.query.lang === "en") return "en";
  if (req.body.Digits === "2") return "es";
  return "en";
}

function deptFrom(req) {
  const digit = req.body.Digits;
  if (digit === "0") return "admin";
  if (digit === "1") return "tech";
  if (digit === "2") return "operator";
  const q = req.query.dept;
  if (q === "admin" || q === "tech" || q === "operator") return q;
  return null;
}

module.exports = { langFrom, deptFrom };
