// ============================================================
// thermal-printer.js — ESC/POS via WebUSB
// The Kebab Factory KDS / POS
//
// CARA PAKAI:
//   1. Sertakan file ini di KDS HTML: <script src="thermal-printer.js"></script>
//   2. Tombol connect: await printer.connect()
//   3. Cetak struk   : await printer.printOrder(orderObject)
//
// PRINTER YANG DIDUKUNG (VendorID terdaftar):
//   Epson, Xprinter, Rongta, MUNBYN, iDPRT, Gainscha, Generic USB
//
// CATATAN:
//   - Hanya bekerja di Chrome / Edge (WebUSB API)
//   - User harus klik tombol dulu sebelum connect (user gesture required)
//   - Lebar kertas diasumsikan 58mm (32 karakter per baris)
//     Ganti COLS = 48 jika pakai 80mm
// ============================================================

class ThermalPrinter {
  constructor(options = {}) {
    this.device      = null;
    this.epOut       = null;
    this.COLS        = options.cols || 32; // 58mm=32, 80mm=48
    this.connected   = false;
  }

  // ── VENDOR IDs printer thermal USB umum ─────────────────
  static get VENDOR_IDS() {
    return [
      { vendorId: 0x04b8 }, // Epson
      { vendorId: 0x0519 }, // Star Micronics
      { vendorId: 0x1504 }, // Xprinter (XP-58, XP-80)
      { vendorId: 0x0fe6 }, // ICS Advent
      { vendorId: 0x0dd4 }, // Custom Engineering
      { vendorId: 0x6868 }, // Rongta (RP58, RP80)
      { vendorId: 0x2730 }, // MUNBYN
      { vendorId: 0x28e9 }, // Gainscha / iDPRT
      { vendorId: 0x0483 }, // Generic STM32 USB-Serial
    ];
  }

  // ── Hubungkan ke printer ─────────────────────────────────
  async connect() {
    if (!navigator.usb) {
      throw new Error('WebUSB tidak didukung browser ini. Gunakan Chrome/Edge.');
    }

    try {
      this.device = await navigator.usb.requestDevice({
        filters: ThermalPrinter.VENDOR_IDS
      });

      await this.device.open();

      if (this.device.configuration === null) {
        await this.device.selectConfiguration(1);
      }

      // Cari interface & endpoint OUT bulk
      let claimed = false;
      for (const iface of this.device.configuration.interfaces) {
        for (const alt of iface.alternates) {
          for (const ep of alt.endpoints) {
            if (ep.direction === 'out' && ep.type === 'bulk') {
              await this.device.claimInterface(iface.interfaceNumber);
              this.epOut   = ep.endpointNumber;
              claimed      = true;
              break;
            }
          }
          if (claimed) break;
        }
        if (claimed) break;
      }

      if (!claimed) throw new Error('Endpoint OUT tidak ditemukan pada printer ini.');

      this.connected = true;

      // Inisialisasi printer
      await this._send(this._cmd(0x1B, 0x40));

      console.log('Printer terhubung:', this.device.productName);
      return { ok: true, name: this.device.productName };

    } catch (err) {
      this.connected = false;
      throw err;
    }
  }

  // ── Putus koneksi ────────────────────────────────────────
  async disconnect() {
    if (this.device) {
      try { await this.device.close(); } catch(e) {}
      this.device    = null;
      this.epOut     = null;
      this.connected = false;
    }
  }

  // ── Cetak struk order ────────────────────────────────────
  //
  // Parameter `order` adalah objek dari Apps Script getAllOrders:
  // { orderId, timestamp, nama, noWA, pengiriman, alamat,
  //   ongkir, pembayaran, items, total, sumber, status }
  //
  async printOrder(order) {
    if (!this.connected) throw new Error('Printer belum terhubung.');

    const cols   = this.COLS;
    const parts  = []; // array Uint8Array, di-merge sebelum dikirim

    const add = (...chunks) => chunks.forEach(c => parts.push(c));
    const txt = (s) => new TextEncoder().encode(s + '\n');
    const sep = () => txt('-'.repeat(cols));
    const dsp = () => txt('='.repeat(cols));

    // ── HEADER ──────────────────────────────────────────────
    add(
      this._INIT,
      this._CENTER,
      this._BOLD_ON, this._SIZE_2X,
      txt('KEBAB FACTORY'),
      this._SIZE_NORMAL,
      txt('A Grilled Passion'),
      txt('Jl. Mlarak-Jabung, Ponorogo'),
      txt('WA: 0813-5768-3151'),
      this._BOLD_OFF,
      dsp()
    );

    // ── INFO ORDER ──────────────────────────────────────────
    add(
      this._LEFT,
      txt(`Order ID : ${order.orderId}`),
      txt(`Waktu    : ${order.timestamp}`),
      txt(`Nama     : ${order.nama}`)
    );

    // Badge sumber
    const sumberLabel = (order.sumber || 'WEB') === 'WHATSAPP' ? '💬 WhatsApp' : '🌐 Website';
    add(txt(`Sumber   : ${sumberLabel}`));
    add(sep());

    // ── ITEMS ────────────────────────────────────────────────
    // Format items: "NamaMenu(Varian)x2"
    const itemList = (order.items || '').split(', ');
    itemList.forEach(item => {
      // item = "Kebab Original(Pedas)x2"
      const match = item.match(/^(.+)\((.+)\)x(\d+)$/);
      if (match) {
        const [, nama, varian, qty] = match;
        const menuData = this._findMenu(nama.trim());
        const harga    = menuData ? menuData.harga : 0;
        const subtotal = harga * parseInt(qty);
        const left     = `${qty}x ${nama.trim()} (${varian})`;
        const right    = subtotal > 0 ? `Rp${(subtotal/1000).toFixed(0)}rb` : '';
        add(txt(this._padLR(left, right, cols)));
      } else {
        add(txt(item));
      }
    });
    add(sep());

    // ── PENGIRIMAN & PEMBAYARAN ──────────────────────────────
    add(txt(`Pengiriman : ${order.pengiriman || '-'}`));

    if ((order.pengiriman || '').toLowerCase().includes('delivery')) {
      add(txt(`Ongkir     : ${order.ongkir || '-'}`));
      const alamat = (order.alamat || '-');
      // Alamat bisa panjang — wrap per cols karakter
      const wrapped = this._wrap('Alamat     : ' + alamat, cols);
      wrapped.forEach(line => add(txt(line)));
    }

    add(txt(`Pembayaran : ${order.pembayaran || '-'}`));
    add(sep());

    // ── TOTAL ────────────────────────────────────────────────
    add(
      this._BOLD_ON,
      txt(this._padLR('TOTAL', order.total || '-', cols)),
      this._BOLD_OFF,
      dsp()
    );

    // ── FOOTER ──────────────────────────────────────────────
    add(
      this._CENTER,
      txt('Terima kasih sudah memesan!'),
      txt('Selamat menikmati kebab Anda :)'),
      txt('')
    );

    // ── STATUS ──────────────────────────────────────────────
    if (order.status) {
      add(txt(`Status: ${order.status}`));
    }

    add(
      this._LF, this._LF, this._LF,
      this._CUT
    );

    // Gabungkan semua & kirim
    const merged = this._merge(parts);
    await this._send(merged);
  }

  // ── Cetak teks bebas (untuk testing) ─────────────────────
  async printTest() {
    if (!this.connected) throw new Error('Printer belum terhubung.');
    const parts = [
      this._INIT,
      this._CENTER,
      this._BOLD_ON,
      new TextEncoder().encode('TEST PRINT\n'),
      this._BOLD_OFF,
      new TextEncoder().encode('The Kebab Factory\n'),
      new TextEncoder().encode('Printer OK!\n'),
      this._LF, this._LF,
      this._CUT,
    ];
    await this._send(this._merge(parts));
  }

  // ── ESC/POS COMMANDS ────────────────────────────────────
  get _INIT()       { return this._cmd(0x1B, 0x40); }
  get _CUT()        { return this._cmd(0x1D, 0x56, 0x41, 0x05); }
  get _LF()         { return this._cmd(0x0A); }
  get _BOLD_ON()    { return this._cmd(0x1B, 0x45, 0x01); }
  get _BOLD_OFF()   { return this._cmd(0x1B, 0x45, 0x00); }
  get _CENTER()     { return this._cmd(0x1B, 0x61, 0x01); }
  get _LEFT()       { return this._cmd(0x1B, 0x61, 0x00); }
  get _SIZE_2X()    { return this._cmd(0x1D, 0x21, 0x11); }
  get _SIZE_NORMAL(){ return this._cmd(0x1D, 0x21, 0x00); }

  _cmd(...bytes)    { return new Uint8Array(bytes); }

  // ── INTERNAL HELPERS ────────────────────────────────────

  // Kirim data ke printer
  async _send(data) {
    await this.device.transferOut(this.epOut, data);
  }

  // Gabungkan array Uint8Array menjadi satu buffer
  _merge(chunks) {
    const total  = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(total);
    let   offset = 0;
    chunks.forEach(c => { result.set(c, offset); offset += c.length; });
    return result;
  }

  // Teks kiri-kanan dalam satu baris (padding)
  _padLR(left, right, cols) {
    const gap = cols - left.length - right.length;
    return gap > 0
      ? left + ' '.repeat(gap) + right
      : left.substring(0, cols - right.length - 1) + ' ' + right;
  }

  // Word wrap sederhana
  _wrap(text, cols) {
    const words  = text.split(' ');
    const lines  = [];
    let   line   = '';
    words.forEach(w => {
      if ((line + w).length > cols) { lines.push(line.trimEnd()); line = ''; }
      line += w + ' ';
    });
    if (line.trim()) lines.push(line.trimEnd());
    return lines;
  }

  // Cari harga menu berdasarkan nama (untuk kalkulasi subtotal di struk)
  _findMenu(nama) {
    const menu = [
      { nama: 'Kebab Original',             harga: 10000 },
      { nama: 'Kebab Telur',                harga: 15000 },
      { nama: 'Kebab Keju',                 harga: 15000 },
      { nama: 'Kebab Sosis',                harga: 15000 },
      { nama: 'Double Bid: Telur + Keju',   harga: 20000 },
      { nama: 'Double Bid: Telur + Sosis',  harga: 20000 },
      { nama: 'Double Bid: Keju + Sosis',   harga: 20000 },
      { nama: 'Triple Bid: Telur+Keju+Sosis', harga: 25000 },
    ];
    return menu.find(m =>
      m.nama.toLowerCase().includes(nama.toLowerCase()) ||
      nama.toLowerCase().includes(m.nama.toLowerCase().split(':')[0].trim().toLowerCase())
    );
  }
}

// ── SINGLETON GLOBAL ─────────────────────────────────────────
window.printer = new ThermalPrinter({ cols: 32 }); // ganti 48 untuk 80mm
