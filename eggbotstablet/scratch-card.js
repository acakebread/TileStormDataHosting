// Copyright 2026 massivehadron.com ltd.
// Based on Scratch Bling, copyright 2016 massivehadron.com ltd. created 29/09/2016 by Andrew Cakebread

import {element, number} from './ui.js';

// Mega Rich's layout in card pixels, with Unity's bottom-left anchors converted to top-left.
const face = {x: 0, y: 0, width: 1984, height: 1152};
const game = inside(face, .4052, .2812, .9567, .8125);
const tab = inside(game, .1451, .9595, .8574, 1.0794);
const columns = [[.022058824, .3345588], [.34375, .65625], [.66544116, .97794116]];
const rows = [[.0394737, .3355263], [.3519737, .64802632], [.66447368, .960526317]];
const cells = rows.flatMap(([top, bottom]) => columns.map(([left, right]) => inside(game, left, top, right, bottom)));
const prizes = cells.map(({x, y, width, height}) => ({x: x + 6, y: y + 6, width: width - 12, height: height - 12}));
const radius = .07 / .75 * face.height;
const moveTexel = game.width / 384;
const leading = ['ON', 'TW', 'TR', 'FR', 'FV', 'SX', 'SN', 'ET', 'NN', 'TN'];
const magnitude = ['TEN', 'HND', 'THOU', 'TTHO', 'HHOU', 'MIL', 'TMIL'];

export const dollars = amount => '$' + number.format(amount);

function inside({x, y, width, height}, left, top, right, bottom) {
  return {x: x + left * width, y: y + top * height, width: (right - left) * width, height: (bottom - top) * height};
}

function canvas(area, pixelsAcross) {
  const node = element('canvas');
  node.width = Math.round(pixelsAcross);
  node.height = Math.round(pixelsAcross * area.height / area.width);
  node.style.left = 100 * area.x / face.width + '%';
  node.style.top = 100 * area.y / face.height + '%';
  node.style.width = 100 * area.width / face.width + '%';
  node.style.height = 100 * area.height / face.height + '%';
  const context = node.getContext('2d');
  context.setTransform(node.width / area.width, 0, 0, node.height / area.height,
    -area.x * node.width / area.width, -area.y * node.height / area.height);
  return {node, context};
}

async function loadImage(src) {
  if (!src) throw new Error('Missing scratch card artwork');
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.draggable = false;
  image.src = src;
  await image.decode();
  return image;
}

function crop(context, image, area) {
  const sx = image.naturalWidth / face.width;
  const sy = image.naturalHeight / face.height;
  context.drawImage(image, area.x * sx, area.y * sy, area.width * sx, area.height * sy,
    area.x, area.y, area.width, area.height);
}

// Keep the sprite's corners and edges at their original size, as Unity's sliced images do.
function sliced(context, image, {x, y, width, height}, horizontal, vertical = horizontal) {
  const sx = [0, horizontal, image.naturalWidth - horizontal, image.naturalWidth];
  const sy = [0, vertical, image.naturalHeight - vertical, image.naturalHeight];
  const dx = [x, x + horizontal, x + width - horizontal, x + width];
  const dy = [y, y + vertical, y + height - vertical, y + height];
  for (let row = 0; row < 3; row++) {
    if (sy[row] === sy[row + 1]) continue;
    for (let col = 0; col < 3; col++) {
      context.drawImage(image, sx[col], sy[row], sx[col + 1] - sx[col], sy[row + 1] - sy[row],
        dx[col], dy[row], dx[col + 1] - dx[col], dy[row + 1] - dy[row]);
    }
  }
}

function print(context, text, area, color, verticalScale = 1) {
  context.save();
  context.translate(area.x + area.width / 2, area.y + area.height / 2);
  const size = area.height;
  context.font = `bold ${size}px Arial, sans-serif`;
  const fitted = Math.min(size, size * area.width / context.measureText(text).width);
  context.font = `bold ${fitted}px Arial, sans-serif`;
  context.fillStyle = color;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  // Unity fits the amount before doubling the glyph height.
  context.scale(1, verticalScale);
  context.fillText(text, 0, 0);
  context.restore();
}

export async function loadScratchCard(data) {
  const hosted = 'MHScratch/Textures/';
  const local = './art/scratch/';
  const [artwork, contour, finger, outline, corners, symbol, instructions, glow] = await Promise.all([
    data.media(hosted + 'cards/card01'), data.media(hosted + 'contours/contour0001'), data.media(hosted + 'finger_content'),
    local + 'game_outline.png', local + 'game_background.png', local + 'symbol_background.png',
    local + 'instructions_background_2.png', local + 'win_highlight_128x128.png'
  ].map(loadImage));

  const paper = canvas(face, face.width);
  const foil = canvas(game, 768);
  const label = canvas(tab, tab.width);
  const zones = prizes.map(prize => {
    const scaleX = foil.node.width / game.width;
    const scaleY = foil.node.height / game.height;
    return {
      left: Math.ceil((prize.x - game.x) * scaleX), right: Math.floor((prize.x + prize.width - game.x) * scaleX),
      top: Math.ceil((prize.y - game.y) * scaleY), bottom: Math.floor((prize.y + prize.height - game.y) * scaleY)
    };
  });
  const prizePixels = zones.reduce((total, zone) => total + (zone.right - zone.left) * (zone.bottom - zone.top), 0);
  finger.className = 'scratch-finger';
  finger.alt = '';
  finger.hidden = true;
  const layers = [paper.node, foil.node, label.node, finger];
  for (const layer of layers) layer.setAttribute('aria-hidden', 'true');

  sliced(label.context, instructions, tab, 200, 0);
  print(label.context, "MATCH 3 'PRIZES' TO WIN", inside(tab, .07238, .2254, .9276, .94819), '#000');

  function deal(amounts) {
    crop(paper.context, artwork, face);
    crop(paper.context, contour, game);
    sliced(paper.context, corners, game, 48);
    crop(foil.context, artwork, game);
    sliced(foil.context, outline, game, 32);
    for (const [index, prize] of prizes.entries()) {
      const amount = String(amounts[index]);
      sliced(paper.context, symbol, prize, 32);
      print(paper.context, dollars(amounts[index]), inside(prize, .04, .1685, .96, .635), '#000', 2);
      print(paper.context, leading[Number(amount[0]) - 1] + magnitude[amount.length - 2],
        inside(prize, 0, .7798, 1, .98005), '#000');
      const cover = inside(prize, .06063, .1222, .9394, .8778);
      print(foil.context, 'PRIZE', {...cover, x: cover.x + 3, y: cover.y - 3}, '#5f605a');
      print(foil.context, 'PRIZE', cover, '#fff');
    }
  }

  function point(event) {
    const bounds = paper.node.getBoundingClientRect();
    return {x: (event.clientX - bounds.left) * face.width / bounds.width,
      y: (event.clientY - bounds.top) * face.height / bounds.height};
  }

  function stroke(from, to) {
    if (Math.min(from.x, to.x) - radius > game.x + game.width || Math.max(from.x, to.x) + radius < game.x ||
        Math.min(from.y, to.y) - radius > game.y + game.height || Math.max(from.y, to.y) + radius < game.y) return false;
    const context = foil.context;
    context.save();
    context.globalCompositeOperation = 'destination-out';
    context.beginPath();
    if (from === to) {
      context.arc(to.x, to.y, radius, 0, 2 * Math.PI);
      context.fill();
    } else {
      context.lineWidth = radius * 2;
      context.lineCap = 'round';
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }
    context.restore();
    return true;
  }

  function isBare() {
    const {width, height} = foil.node;
    const {data: pixels} = foil.context.getImageData(0, 0, width, height);
    const threshold = .01 * prizePixels * 255;
    let covered = 0;
    for (const {top, bottom, left, right} of zones) {
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) covered += pixels[(y * width + x) * 4 + 3];
        if (covered >= threshold) return false;
      }
    }
    return true;
  }

  return {layers, finger, deal, point, stroke, isBare, moveTexel,
    clear() { foil.context.clearRect(game.x, game.y, game.width, game.height); },
    highlight(index) {
      paper.context.save();
      paper.context.globalAlpha = .391;
      sliced(paper.context, glow, cells[index], 48);
      paper.context.restore();
    }};
}
