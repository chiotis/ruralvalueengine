import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { colors } from "../lib/theme";

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: "business" | "route" | "poi";
  title: string;
  /** Short tag next to the pin when zoomed in, e.g. the points a visit earns ("+10"). */
  label?: string | null;
}

/**
 * Map without an API key: Leaflet + OpenStreetMap tiles inside a WebView.
 * For production traffic, point TILE_URL at a tile provider with an agreement (e.g. MapTiler).
 */
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
/** Pin colours stay the brand originals: they sit on light map tiles, not on the dark app. */
export const PIN_COLOR = { business: "#7a3123", route: "#2d9141", poi: "#8a5a3c" } as const;
const KIND_COLOR = PIN_COLOR;
/** Pin labels appear from this zoom level, so the whole-country view stays readable. */
const LABEL_ZOOM = 12;

/** A named point along a route's path (from its KML). */
export interface MapStop {
  name: string;
  lat: number;
  lng: number;
}

function html(markers: MapMarker[], lines: [number, number][][], stops: MapStop[], center: [number, number] | null, me: [number, number] | null) {
  // Escape "<" so names can't close the script tag.
  const data = JSON.stringify({ markers, lines, stops, center, me, colors: KIND_COLOR, line: colors.greenBright, labelZoom: LABEL_ZOOM }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
html,body,#m{height:100%;margin:0;background:${colors.sand}}
.leaflet-tooltip{font:600 13px system-ui;border-radius:10px}
.pin{position:relative;width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);box-sizing:border-box}
.pin b{display:none;position:absolute;left:18px;top:-4px;white-space:nowrap;font:800 11px system-ui;color:#2d9141;background:#fff;border-radius:9px;padding:2px 6px;box-shadow:0 1px 4px rgba(0,0,0,.25)}
.z .pin b{display:block}
.stop{width:12px;height:12px;border-radius:50%;background:#fff;border:3px solid ${colors.greenBright};box-sizing:border-box}
.me{width:16px;height:16px;border-radius:50%;background:#2b7bd6;border:3px solid #fff;box-shadow:0 0 0 6px rgba(43,123,214,.25);box-sizing:border-box}
</style></head>
<body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var d=${data};
function send(o){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(o))}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
var map=L.map('m',{zoomControl:false});
L.tileLayer('${TILE_URL}',{maxZoom:18,attribution:'© OpenStreetMap'}).addTo(map);
var b=[],tb=[];
d.lines.forEach(function(l){
  L.polyline(l,{color:'#fff',weight:7,opacity:.9,interactive:false}).addTo(map);
  L.polyline(l,{color:d.line,weight:4,interactive:false}).addTo(map);
  tb=tb.concat(l);
});
d.stops.forEach(function(s){
  L.marker([s.lat,s.lng],{icon:L.divIcon({className:'',iconSize:[12,12],iconAnchor:[6,6],html:'<div class="stop"></div>'})})
    .bindTooltip(esc(s.name),{direction:'top',offset:[0,-6]}).addTo(map);
  tb.push([s.lat,s.lng]);
});
d.markers.forEach(function(p){
  var icon=L.divIcon({className:'',iconSize:[18,18],iconAnchor:[9,9],
    html:'<div class="pin" style="background:'+d.colors[p.kind]+'">'+(p.label?'<b>'+esc(p.label)+'</b>':'')+'</div>'});
  var m=L.marker([p.lat,p.lng],{icon:icon}).addTo(map);
  m.bindTooltip(esc(p.title),{direction:'top',offset:[0,-8]});
  m.on('click',function(e){L.DomEvent.stopPropagation(e);send({type:'select',id:p.id})});
  b.push([p.lat,p.lng]);
});
if(d.me){L.marker(d.me,{icon:L.divIcon({className:'',iconSize:[16,16],iconAnchor:[8,8],html:'<div class="me"></div>'}),interactive:false}).addTo(map);}
function zoomClass(){document.getElementById('m').classList.toggle('z',map.getZoom()>=d.labelZoom)}
map.on('zoomend',zoomClass);
map.on('click',function(){send({type:'tap'})});
// A route's own path frames the map; nearby places can be panned to.
if(tb.length){b=tb}
if(d.center){map.setView(d.center,13)}else if(b.length){map.fitBounds(b,{padding:[30,30],maxZoom:14})}else{map.setView([38.3,23.5],6)}
zoomClass();
</script></body></html>`;
}

export function LeafletMap(props: {
  markers: MapMarker[];
  lines?: [number, number][][];
  stops?: MapStop[];
  center?: [number, number] | null;
  me?: [number, number] | null;
  onSelect?: (id: string) => void;
  /** A tap on the map itself, not on a pin. */
  onTapMap?: () => void;
  height?: number;
}) {
  const source = useMemo(
    () => ({ html: html(props.markers, props.lines ?? [], props.stops ?? [], props.center ?? null, props.me ?? null) }),
    [props.markers, props.lines, props.stops, props.center, props.me],
  );
  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as { type: string; id?: string };
      if (msg.type === "select" && msg.id) props.onSelect?.(msg.id);
      if (msg.type === "tap") props.onTapMap?.();
    } catch {
      // Ignore anything that isn't ours.
    }
  };
  return (
    <View style={[styles.wrap, props.height ? { height: props.height, borderRadius: 22 } : { flex: 1 }]}>
      <WebView originWhitelist={["*"]} source={source} onMessage={onMessage} javaScriptEnabled setSupportMultipleWindows={false} />
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { overflow: "hidden", backgroundColor: colors.sand } });
