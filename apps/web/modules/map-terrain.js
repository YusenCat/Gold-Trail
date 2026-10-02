// Original SVG terrain and location illustrations; no external image/font dependency.
export function drawTerrain(svg) {
  const terrain=svg('g',{class:'atlas-terrain','aria-hidden':'true'});
  const defs=svg('defs',{});
  const paper=svg('radialGradient',{id:'atlas-paper',cx:'.42',cy:'.3',r:'.8'});
  paper.append(svg('stop',{offset:'0','stop-color':'#faf3df'}),svg('stop',{offset:'1','stop-color':'#e6d4af'}));
  defs.append(paper);
  const snow=svg('linearGradient',{id:'atlas-snow',x1:'0',y1:'0',x2:'0',y2:'1'});
  snow.append(svg('stop',{offset:'0','stop-color':'#fff9e8'}),svg('stop',{offset:'1','stop-color':'#aeb9a6'}));
  defs.append(snow); terrain.append(defs,svg('rect',{x:0,y:0,width:1200,height:840,fill:'url(#atlas-paper)'}));
  terrain.append(svg('path',{d:'M35 215 Q135 95 250 145 T470 230 L510 270 Q365 210 240 235 T35 285 Z',class:'terrain-wash ridge-wash'}));
  terrain.append(svg('path',{d:'M715 285 Q855 210 950 315 Q995 400 900 510 Q770 560 700 480 Q675 360 715 285Z',class:'terrain-wash forest-wash'}));
  terrain.append(svg('path',{d:'M70 550 Q215 450 375 485 T485 660 Q330 755 100 690Z',class:'terrain-wash meadow-wash'}));
  terrain.append(svg('path',{d:'M850 640 Q1010 555 1155 610 L1190 775 Q1050 810 940 765Z',class:'terrain-wash ochre-wash'}));
  const river='M425 -20 C385 100 460 160 440 250 S345 390 400 485 S480 580 445 665 S390 785 460 860';
  terrain.append(svg('path',{d:river,class:'atlas-river-bank'}),svg('path',{d:river,class:'atlas-river'}),svg('path',{d:river,class:'atlas-river-glint'}));
  for(const [x,y,s] of [[90,220,1],[165,180,1.25],[255,220,.95],[320,195,.9],[220,280,.7],[100,310,.55]]) {
    const peak=svg('g',{transform:`translate(${x} ${y}) scale(${s})`,class:'atlas-mountain'});
    peak.append(svg('path',{d:'M-62 38 L-22 -40 L-4 -15 L22 -72 L70 38 Q8 15 -62 38Z',fill:'url(#atlas-snow)'}),svg('path',{d:'M22 -72 L10 -20 L30 -34 L42 -22 M-22 -40 L-27 -12 L-14 -18 L-4 -15',class:'mountain-snow'}),svg('path',{d:'M22 -72 L28 8 L70 38 M-22 -40 L-16 20 L-62 38',class:'mountain-hatch'}));
    terrain.append(peak);
  }
  for(let i=0;i<38;i++) {
    const x=715+(i*59%215),y=295+(i*43%205),s=.7+(i%4)*.15;
    const tree=svg('g',{transform:`translate(${x} ${y}) scale(${s})`,class:'atlas-tree'});
    tree.append(svg('path',{d:'M0 17 V30',class:'tree-trunk'}),svg('path',{d:'M0 -20 L-10 -4 H-6 L-15 10 H-8 L-19 23 H19 L8 10 H15 L6 -4 H10 Z',class:'tree-crown'}),svg('path',{d:'M-8 -4 L0 -20 L6 -5 M-13 10 L0 -6 L10 10',class:'tree-snow'}));
    terrain.append(tree);
  }
  terrain.append(svg('text',{x:220,y:94,class:'atlas-region'},'兴 安 雪 岭'),svg('text',{x:825,y:270,class:'atlas-region'},'北 境 林 海'),svg('text',{x:290,y:548,class:'atlas-region atlas-small-region'},'墨尔根官道'));
  const compass=svg('g',{transform:'translate(1100 130)',class:'atlas-compass'});
  compass.append(svg('circle',{r:36}),svg('circle',{r:27}),svg('path',{d:'M0 -42 L9 0 L0 42 L-9 0Z'}),svg('path',{d:'M-42 0 L0 -9 L42 0 L0 9Z',class:'compass-cross'}),svg('text',{y:-51,'text-anchor':'middle'},'北'));
  terrain.append(compass);
  terrain.append(svg('path',{d:'M45 65 V35 H75 M1125 35 H1155 V65 M45 775 V805 H75 M1125 805 H1155 V775',class:'atlas-corners'}));
  terrain.append(svg('text',{x:600,y:811,class:'atlas-note'},'两点之间，一段驿道 = 一步 · 虚线为捷径'));
  return terrain;
}

export function drawLocation(svg,type) {
  const art=svg('g',{class:'atlas-location-art','aria-hidden':'true'});
  if(type==='mine') {
    art.append(svg('path',{d:'M-29 14 L-13 -21 L-1 -9 L12 -31 L33 14Z',class:'city-mountain'}),svg('path',{d:'M-13 -21 L-18 -8 L-10 -12 L-1 -9 M12 -31 L7 -12 L16 -18 L21 -9',class:'city-snow'}),svg('path',{d:'M-13 17 V-1 Q0 -20 13 -1 V17Z',class:'mine-entry'}),svg('path',{d:'M-16 17 V-3 M16 17 V-3 M-20 -3 H20',class:'city-timber'}),svg('path',{d:'M-3 16 L1 7 L8 8 L12 16Z',class:'city-gold'}));
  } else if(type==='checkpoint') {
    art.append(svg('path',{d:'M-15 22 V-20 H15 V22Z',class:'city-wall'}),svg('path',{d:'M-20 -21 V-28 H-12 V-21 H-4 V-28 H4 V-21 H12 V-28 H20 V-21Z',class:'city-roof'}),svg('path',{d:'M-4 22 V-4 H4 V22 M-16 7 H16',class:'city-timber'}),svg('path',{d:'M18 -22 V-38 L33 -33 L18 -28',class:'city-flag'}));
  } else {
    art.append(svg('path',{d:'M-23 18 V-6 H23 V18Z',class:'city-wall'}),svg('path',{d:'M-31 -5 L0 -28 L31 -5 L24 0 H-24Z',class:'city-roof'}),svg('path',{d:'M-8 18 V-3 H8 V18 M-18 3 H-12 M12 3 H18',class:'city-timber'}),svg('path',{d:'M-34 21 H34',class:'city-ground'}));
    if(type==='bazaar') art.append(svg('path',{d:'M-28 5 H-11 V19 H-28Z M13 8 H30 V20 H13Z',class:'city-crates'}),svg('path',{d:'M-30 3 L-27 -6 H-12 L-9 3Z',class:'city-awning'}));
    if(type==='morgeng') art.append(svg('path',{d:'M-30 -10 V-37 L-15 -31 L-30 -24',class:'city-flag'}));
    if(type==='hub') art.append(svg('circle',{cx:24,cy:6,r:5,class:'city-lantern'}));
  }
  return art;
}
