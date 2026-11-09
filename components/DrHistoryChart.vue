<template>
  <div class="mt-1">
    <div class="relative h-48 w-full border border-[#e3e3e3]">
      <canvas ref="canvas" role="img" :aria-label="`DR history for ${domain}`" />
    </div>
    <div class="mt-1 space-y-0.5 text-[11px] text-[#555]">
      <p class="flex flex-wrap items-center gap-x-3">
        <span>Dot: DR level</span>
        <span v-for="(label, band) in DR_BAND_LABELS" :key="band" class="inline-flex items-center gap-1">
          <span class="h-2 w-2 rounded-full" :style="{ backgroundColor: DR_BAND_COLORS[band] }" aria-hidden="true" />{{ label }}
        </span>
      </p>
      <p class="flex flex-wrap items-center gap-x-3">
        <span>Line: DR change</span>
        <span v-for="(label, dir) in LINE_LABELS" :key="dir" class="inline-flex items-center gap-1">
          <span class="h-0.5 w-3" :style="{ backgroundColor: DELTA_COLORS[dir] }" aria-hidden="true" />{{ label }}
        </span>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Chart } from "chart.js";

const props = defineProps<{ days: { dr: number; checked_at: string }[]; domain: string }>();

const ACCENT = "#0071e3";
const LINE_LABELS = { up: "up", down: "down", flat: "no change" } as const;
const canvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart<"line", ChartPoint[]> | null = null;
let unmounted = false;

async function draw() {
  const { Chart, LineController, LineElement, PointElement, LinearScale, Tooltip } = await import("chart.js");
  if (unmounted || !canvas.value) return;
  Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip);
  const points = historyChartPoints(props.days);
  const dotColors = points.map((p) => DR_BAND_COLORS[drBand(p.y)]);
  chart?.destroy();
  chart = new Chart(canvas.value, {
    type: "line",
    data: {
      datasets: [{
        data: points,
        borderColor: ACCENT,
        backgroundColor: ACCENT,
        pointBackgroundColor: dotColors,
        pointBorderColor: dotColors,
        segment: { borderColor: (ctx) => drSegmentColor(points, ctx.p1DataIndex) },
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        clip: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      scales: {
        x: {
          type: "linear",
          min: points[0].x,
          max: points[points.length - 1].x,
          // One tick per reading: generated ticks would land on arbitrary
          // milliseconds and repeat the same date for close readings.
          afterBuildTicks: (axis) => { axis.ticks = points.map((p) => ({ value: p.x })); },
          ticks: { callback: (v) => isoDate(new Date(Number(v)).toISOString()), maxRotation: 0 },
          grid: { display: false },
        },
        y: {
          min: 0,
          max: 100,
          ticks: { stepSize: 25 },
          grid: { color: "#e3e3e3" },
        },
      },
      plugins: {
        tooltip: {
          displayColors: false,
          callbacks: {
            title: () => "",
            label: (ctx) => drPointLabel(points, ctx.dataIndex),
          },
        },
      },
    },
  });
}

onMounted(draw);
watch(() => props.days, draw);
onBeforeUnmount(() => {
  unmounted = true;
  chart?.destroy();
  chart = null;
});
</script>
