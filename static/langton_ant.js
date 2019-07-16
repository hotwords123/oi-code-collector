
let Ant = (function() {

    'use strict';

    const tileSize = 16;

    let $canvas = $('<canvas>');
    let canvas = $canvas.get(0);
    let ctx = canvas.getContext('2d');

    let width = 0, height = 0;
    let antX, antY, antVector;
    let tiles = [];

    $canvas.css({
        'position': 'fixed',
        'left': 0,
        'top': 0,
        'z-index': '-1',
        'pointer-events': 'none'
    });
    $('body').append($canvas);

    function randomTileColor() {
        return 0;
    }

    function adjustSize(newWidth, newHeight) {
        while (width < newWidth) {
            let column = [];
            for (let i = 0; i < height; ++i) {
                column.push(randomTileColor());
            }
            tiles.push(column);
            ++width;
        }
        while (width > newWidth) {
            tiles.pop();
            --width;
        }
        while (height < newHeight) {
            for (let i = 0; i < width; ++i) {
                tiles[i].push(randomTileColor());
            }
            ++height;
        }
        while (height > newHeight) {
            for (let i = 0; i < width; ++i) {
                tiles[i].pop();
            }
            --height;
        }
        canvas.width = width * tileSize;
        canvas.height = height * tileSize;
    }

    function resizeHandler(isInit) {
        var width = Math.floor(window.innerWidth / tileSize);
        var height = Math.floor(window.innerHeight / tileSize);
        adjustSize(width, height);
        if (isInit) {
            antX = Math.floor(width / 2);
            antY = Math.floor(height / 2);
            antVector = [0, -1];
        }
        render();
    }

    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#f3f3f3';
        for (let x = 0; x < width; ++x) {
            for (let y = 0; y < height; ++y) {
                if (tiles[x][y] === 1) {
                    ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
                }
            }
        }
    }

    function drawTile(x, y, color) {
        if (tiles[x][y] === 1) {
            ctx.fillStyle = '#f3f3f3';
            ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
        } else {
            ctx.clearRect(x * tileSize, y * tileSize, tileSize, tileSize);
        }
    }

    function transformVector(size, vector, matrix) {
        let result = new Array(size);
        for (let i = 0; i < size; ++i) {
            result[i] = 0;
            for (let j = 0; j < size; ++j) {
                result[i] += vector[j] * matrix[i][j];
            }
        }
        return result;
    }

    function tick() {
        let color = tiles[antX][antY];
        tiles[antX][antY] = 1 - tiles[antX][antY];
        drawTile(antX, antY, color);
        antVector = transformVector(2, antVector, color === 0 ? [[0, 1], [-1, 0]] : [[0, -1], [1, 0]]);
        antX = (antX + antVector[0] + width) % width;
        antY = (antY + antVector[1] + height) % height;
    }

    resizeHandler(true);
    tick();
    setInterval(tick, 20);
    window.addEventListener('resize', function() {
        resizeHandler(false);
    }, false);

    return {
        getAntPos() {
            return { x: antX, y: antY };
        },
        getAntVector() {
            return { x: antVector[0], y: antVector[1] };
        },
        adjustSize,
        tick
    };

})();
