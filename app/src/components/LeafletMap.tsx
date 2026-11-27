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
}

/**
 * Map without an API key: Leaflet + OpenStreetMap tiles inside a WebView.
 * For production traffic, point TILE_URL at a tile provider with an agreement (e.g. MapTiler).
 */
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const KIND_COLOR = { business: colors.burgundy, route: colors.greenBright, poi: colors.brown } as const;

function html(markers: MapMarker[], lines: [number, number][][], center: [number, number] | null, me: [number, number] | null) {
  const data = JSON.stringify({ markers, lines, center, me, colors: KIND_COLOR, line: colors.green });
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#m{height:100%;margin:0}.leaflet-popup-content{font:14px system-ui}</style></head>
<body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var d=${data};
var map=L.map('m',{zoomControl:false});
L.tileLayer('${TILE_URL}',{maxZoom:18,attribution:'© OpenStreetMap'}).addTo(map);
var b=[];
d.lines.forEach(function(l){L.polyline(l,{color:d.line,weight:4}).addTo(map);b=b.concat(l);});
d.markers.forEach(function(p){
  var c=L.circleMarker([p.lat,p.lng],{radius:8,color:'#fff',weight:2,fillColor:d.colors[p.kind],fillOpacity:1}).addTo(map);
  c.bindTooltip(p.title);
  c.on('click',function(){window.ReactNativeWebView.postMessage(p.id)});
  b.push([p.lat,p.lng]);
});
if(d.me){L.circleMarker(d.me,{radius:7,color:'#fff',weight:3,fillColor:'#2b7bd6',fillOpacity:1}).addTo(map);}
if(d.center){map.setView(d.center,13)}else if(b.length){map.fitBounds(b,{padding:[30,30],maxZoom:14})}else{map.setView([38.3,23.5],6)}
</script></body></html>`;
}

export function LeafletMap(props: {
  markers: MapMarker[];
  lines?: [number, number][][];
  center?: [number, number] | null;
  me?: [number, number] | null;
  onSelect?: (id: string) => void;
  height?: number;
}) {
  const source = useMemo(
    () => ({ html: html(props.markers, props.lines ?? [], props.center ?? null, props.me ?? null) }),
    [props.markers, props.lines, props.center, props.me],
  );
  return (
    <View style={[styles.wrap, props.height ? { height: props.height } : { flex: 1 }]}>
      <WebView
        originWhitelist={["*"]}
        source={source}
        onMessage={(e: WebViewMessageEvent) => props.onSelect?.(e.nativeEvent.data)}
        javaScriptEnabled
        setSupportMultipleWindows={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { overflow: "hidden", backgroundColor: colors.border } });
