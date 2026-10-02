// Presentation coordinates only. The server's graph remains the source of move rules.
export const MAP_VIEWBOX = '0 0 1200 840';
export const mapPositions = {
  HUB:[590,685], W1:[495,720], W2:[400,695], W3:[310,635], W4:[225,695], W5:[135,750], MRG:[105,620],
  E1:[690,725], E2:[790,680], CP_D:[870,735], E4:[970,710], MINE:[1090,675],
  N1:[615,595], N2:[555,520], N3:[620,450], CP_C:[585,365], BAZAAR:[570,130],
  R1:[995,585], R2:[1050,515], CP_E:[975,455], R4:[1020,370], R5:[980,290], R6:[930,220], CP_F:[850,145], R8:[755,160], R9:[660,130],
  F1:[850,570], NW1:[150,510], NW2:[220,430], NW3:[280,350], CP_G:[350,300], NW4:[430,300], NW5:[490,350],
};

// Controls use a canonical endpoint order so previews follow the same road both ways.
const curves = {
  'W2::W4':[[360,765],[270,770]],
  'MRG::W4':[[120,665],[160,685]],
  'BAZAAR::CP_C':[[640,190],[625,280]],
  'E4::F1':[[940,645],[890,640]],
  'E4::R1':[[1010,670],[1015,625]],
  'CP_C::NW5':[[550,405],[520,395]],
};
const keyFor = (a,b) => [a,b].sort().join('::');
export function mapPoint(node) {
  const [x,y] = mapPositions[node.id] ?? [600 + node.x*75,680-node.y*80];
  return {x,y};
}
export function edgeGeometry(from,to) {
  const [a,b]=[from,to].sort((a,b)=>a.id.localeCompare(b.id));
  const p=mapPoint(a),q=mapPoint(b),dx=q.x-p.x,dy=q.y-p.y;
  const length=Math.hypot(dx,dy)||1;
  const bend=keyFor(a.id,b.id).split('').reduce((sum,c)=>sum+c.charCodeAt(0),0)%2 ? 12 : -12;
  let controls=curves[keyFor(a.id,b.id)] ?? [
    [p.x+dx/3-dy/length*bend,p.y+dy/3+dx/length*bend],
    [p.x+dx*2/3-dy/length*bend,p.y+dy*2/3+dx/length*bend],
  ];
  if(from.id!==a.id) controls=[controls[1],controls[0]];
  const start=mapPoint(from),end=mapPoint(to);
  return {start,end,controls};
}
export function edgePath(from,to) {
  const {start,end,controls:[c,d]}=edgeGeometry(from,to);
  return `M${start.x} ${start.y} C${c[0]} ${c[1]} ${d[0]} ${d[1]} ${end.x} ${end.y}`;
}

export const cityLabels = {
  HUB:{x:0,y:-54,subtitle:'北境启程'}, MRG:{x:0,y:-55,subtitle:'官兵交金'},
  MINE:{x:0,y:-55,subtitle:'开采碎金'}, BAZAAR:{x:0,y:-58,subtitle:'走私交金'},
  CP_C:{x:42,y:-10,anchor:'start'}, CP_D:{x:0,y:47}, CP_E:{x:-42,y:-10,anchor:'end'},
  CP_F:{x:0,y:-39}, CP_G:{x:0,y:-40}, F1:{x:0,y:-34},
};
