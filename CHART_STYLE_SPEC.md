# สูตรกราฟสวย "Load Profile Style" (Chart.js)

ใช้กราฟให้ได้หน้าตาแบบ Load Profile Generator — เก็บไว้คัดลอกไปบอก AI agent ได้เลย

---

## 1) ไลบรารีที่ใช้

- **Chart.js v4.4.1** (ไลบรารีกราฟฟรี ออฟไลน์ได้)
- ไฟล์ใช้งาน: `lib/chart.umd.min.js` (โหลดจาก CDN ครั้งเดียวเก็บไว้ในเครื่อง)
- สคริปต์ในหน้า: `<script src="lib/chart.umd.min.js"></script>`

---

## 2) "สูตรลับ" ที่ทำให้สวย (บอก AI แบบนี้)

แค่บอก AI agent ต่อไปนี้ ก็จะได้กราฟหน้าตาแบบเดียวกัน:

> สร้างกราฟเส้น (Line Chart) ด้วย Chart.js v4 ในธีมมืด โดย:
> - **พื้นสีด้านใต้เส้นเป็น Gradient พาดแนวตั้ง** สีฟ้าอ่อนโปร่งใสที่ด้านบน (เช่น rgba(56,189,248,0.35)) จางหายไปจนเกือบใสที่ด้านล่าง (rgba(56,189,248,0.02))
> - เส้นสีฟ้าสว่าง rgba(56,189,248,0.95) หนา 2px
> - โค้งนุ่มด้วย tension = 0.25 (ไม่เป็นเหลี่ยมทื่อ)
> - ไม่แสดงจุด (pointRadius = 0) แต่ให้ช่องเมาส์ทับได้กว้าง (pointHitRadius = 12) เพื่อให้ Touch เลื่อนดู tooltip สะดวกบนมือถือ
> - Tooltip: พื้นมืด #0b1220, ขอบฟ้าโปร่งใส, ตัวเลขชัดเจน
> - แกนนอน: ซ่อนเส้นกริด, แสดงป้ายเวลาหลักเท่านั้น (ทุก 4 ชั่วโมง), ห้ามหมุนป้าย (maxRotation=0, minRotation=0) เพื่อไม่ให้ทับกัน
> - แกนตั้ง: เริ่มที่ศูนย์ (beginAtZero), เส้นกริดสีจาง ๆ, มีชื่อแกน "กำลังไฟฟ้า (kW)"
> - ฟอนต์ทั้งกราฟใช้ระบบ (กำหนด Chart.defaults.font.family + สี #94a3b8)
> - พื้นหลัง canvas ใช้สีพื้นเดียวกับธีมมืดของแอป

---

## 3) โค้ดตั้งค่าต้นแบบ (ตรงจากแอป)

```js
const fillGrad = ctx.createLinearGradient(0, 0, 0, 300);
fillGrad.addColorStop(0, 'rgba(56,189,248,0.35)');
fillGrad.addColorStop(1, 'rgba(56,189,248,0.02)');

const chart = new Chart(ctx, {
  type: 'line',
  data: {
    labels,
    datasets: [{
      data,
      borderColor: 'rgba(56,189,248,0.95)',
      backgroundColor: fillGrad,
      fill: true,
      borderWidth: 2,
      pointRadius: 0,
      pointHitRadius: 12,
      tension: 0.25,
      spanGaps: false
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0b1220',
        borderColor: 'rgba(56,189,248,0.4)',
        borderWidth: 1,
        titleColor: '#94a3b8',
        bodyColor: '#e2e8f0',
        callbacks: {
          title: (items) => items[0].label,
          label: (item) => '  ' + item.parsed.y.toFixed(3) + ' กิโลวัตต์ (kW)'
        }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: true, color: 'rgba(51,65,85,0.4)' },
        ticks: {
          color: '#94a3b8',
          maxRotation: 0,
          minRotation: 0,
          autoSkip: false,
          callback: function (val) {
            // แสดงป้ายเฉพาะช่องเวลา '00:00', '04:00' ... (ทุก 16 จุด)
            const idx = Number(val);
            return (idx % 16 === 0 && labels[idx]) ? labels[idx] : '';
          }
        }
      },
      y: {
        title: { display: true, text: 'กำลังไฟฟ้า (kW)', color: '#94a3b8' },
        grid: { color: 'rgba(51,65,85,0.35)' },
        ticks: { color: '#94a3b8', callback: v => v.toFixed(1) },
        beginAtZero: true
      }
    }
  }
});
```

> ⚠️ `ctx` คือ `document.getElementById('profile-chart').getContext('2d')`
> ⚠️ `labels` คือ array ของป้ายเวลา, `data` คือ array ตัวเลข

---

## 4) จุดที่ทำให้กราฟดู "เป็นธรรมชาติ"

- ข้อมูลต้องมีความ "ขรุขระ" ที่สมจริง — ในแอปนี้คือการจำลอง duty-cycle: ไม่เห็นเส้นตรงราบเป็นอ่าง คือความสวยในส่วนนี้ (ดูเพิ่มในส่วน Simulation ของ README)
- gradient + เส้นฟ้าสว่าง + เควอร์ฟโค้ง + ไม่มีจุดเกะกะ + tooltip มืด → combination นี้คือ "ลายเซ็น" ความสวยของแอปนี้

---

## 5) ดาวน์โหลด Chart.js เป็นไฟล์ไว้เอง (สำหรับทำเว็บออฟไลน์)

ถ้า AI สร้างกราฟแบบนี้ในโปรเจ็กต์ใหม่ ก็ให้ดาวน์โหลดไฟล์เดียวกับที่ใช้ได้จาก:
- `https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js`
- วางไว้ `lib/chart.umd.min.js` แล้วอ้างอิง `<script src="lib/chart.umd.min.js">` ตามเดิม — ไม่ต้องต่อเน็ตตอนใช้งาน