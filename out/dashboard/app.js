(function () {
  'use strict';
  var d = window.RADAR;
  if (!d) {
    var el = document.getElementById('rows');
    if (el) el.textContent = 'No data loaded: run main.ts first to write data.js.';
    return;
  }
  var rows = document.getElementById('rows');
  if (rows) {
    var html = '<table><tr><th>#</th><th>Protocol</th><th>Category</th><th>TVL</th><th>Implied</th></tr>';
    for (var i = 0; i < Math.min(20, d.rows.length); i++) {
      var r = d.rows[i];
      html += '<tr><td class="num">' + r.rank + '</td><td>' + r.name + '</td><td>' + (r.category || '-') +
        '</td><td class="num">$' + r.tvl_usd.toLocaleString() + '</td><td class="num">$' +
        r.implied_value_usd.toLocaleString() + '</td></tr>';
    }
    rows.innerHTML = html + '</table>';
  }
})();
