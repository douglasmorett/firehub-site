async function check() {
  const res = await fetch('https://firehubfood.com.br/api/admin/seed-hakim-menu');
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Body:", text);
}
check();
