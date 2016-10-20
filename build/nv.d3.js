/* nvd3 version 1.8.4-dev (https://github.com/novus/nvd3) 2016-10-21 */
(function(){

// set up main nv object
var nv = {};

// the major global objects under the nv namespace
nv.dev = false; //set false when in production
nv.tooltip = nv.tooltip || {}; // For the tooltip system
nv.utils = nv.utils || {}; // Utility subsystem
nv.models = nv.models || {}; //stores all the possible models/components
nv.charts = {}; //stores all the ready to use charts
nv.logs = {}; //stores some statistics and potential error messages
nv.dom = {}; //DOM manipulation functions

// Node/CommonJS - require D3
if (typeof(module) !== 'undefined' && typeof(exports) !== 'undefined' && typeof(d3) == 'undefined') {
    d3 = require('d3');
}

nv.dispatch = d3.dispatch('render_start', 'render_end');

// Function bind polyfill
// Needed ONLY for phantomJS as it's missing until version 2.0 which is unreleased as of this comment
// https://github.com/ariya/phantomjs/issues/10522
// http://kangax.github.io/compat-table/es5/#Function.prototype.bind
// phantomJS is used for running the test suite
if (!Function.prototype.bind) {
    Function.prototype.bind = function (oThis) {
        if (typeof this !== "function") {
            // closest thing possible to the ECMAScript 5 internal IsCallable function
            throw new TypeError("Function.prototype.bind - what is trying to be bound is not callable");
        }

        var aArgs = Array.prototype.slice.call(arguments, 1),
            fToBind = this,
            fNOP = function () {},
            fBound = function () {
                return fToBind.apply(this instanceof fNOP && oThis
                        ? this
                        : oThis,
                    aArgs.concat(Array.prototype.slice.call(arguments)));
            };

        fNOP.prototype = this.prototype;
        fBound.prototype = new fNOP();
        return fBound;
    };
}

//  Development render timers - disabled if dev = false
if (nv.dev) {
    nv.dispatch.on('render_start', function(e) {
        nv.logs.startTime = +new Date();
    });

    nv.dispatch.on('render_end', function(e) {
        nv.logs.endTime = +new Date();
        nv.logs.totalTime = nv.logs.endTime - nv.logs.startTime;
        nv.log('total', nv.logs.totalTime); // used for development, to keep track of graph generation times
    });
}

// Logs all arguments, and returns the last so you can test things in place
// Note: in IE8 console.log is an object not a function, and if modernizr is used
// then calling Function.prototype.bind with with anything other than a function
// causes a TypeError to be thrown.
nv.log = function() {
    if (nv.dev && window.console && console.log && console.log.apply)
        console.log.apply(console, arguments);
    else if (nv.dev && window.console && typeof console.log == "function" && Function.prototype.bind) {
        var log = Function.prototype.bind.call(console.log, console);
        log.apply(console, arguments);
    }
    return arguments[arguments.length - 1];
};

// print console warning, should be used by deprecated functions
nv.deprecated = function(name, info) {
    if (console && console.warn) {
        console.warn('nvd3 warning: `' + name + '` has been deprecated. ', info || '');
    }
};

// The nv.render function is used to queue up chart rendering
// in non-blocking async functions.
// When all queued charts are done rendering, nv.dispatch.render_end is invoked.
nv.render = function render(step) {
    // number of graphs to generate in each timeout loop
    step = step || 1;

    nv.render.active = true;
    nv.dispatch.render_start();

    var renderLoop = function() {
        var chart, graph;

        for (var i = 0; i < step && (graph = nv.render.queue[i]); i++) {
            chart = graph.generate();
            if (typeof graph.callback == typeof(Function)) graph.callback(chart);
        }

        nv.render.queue.splice(0, i);

        if (nv.render.queue.length) {
            setTimeout(renderLoop);
        }
        else {
            nv.dispatch.render_end();
            nv.render.active = false;
        }
    };

    setTimeout(renderLoop);
};

nv.render.active = false;
nv.render.queue = [];

/*
Adds a chart to the async rendering queue. This method can take arguments in two forms:
nv.addGraph({
    generate: <Function>
    callback: <Function>
})

or

nv.addGraph(<generate Function>, <callback Function>)

The generate function should contain code that creates the NVD3 model, sets options
on it, adds data to an SVG element, and invokes the chart model. The generate function
should return the chart model.  See examples/lineChart.html for a usage example.

The callback function is optional, and it is called when the generate function completes.
*/
nv.addGraph = function(obj) {
    if (typeof arguments[0] === typeof(Function)) {
        obj = {generate: arguments[0], callback: arguments[1]};
    }

    nv.render.queue.push(obj);

    if (!nv.render.active) {
        nv.render();
    }
};

// Node/CommonJS exports
if (typeof(module) !== 'undefined' && typeof(exports) !== 'undefined') {
  module.exports = nv;
}

if (typeof(window) !== 'undefined') {
  window.nv = nv;
}
/* Facade for queueing DOM write operations
 * with Fastdom (https://github.com/wilsonpage/fastdom)
 * if available.
 * This could easily be extended to support alternate
 * implementations in the future.
 */
nv.dom.write = function(callback) {
	if (window.fastdom !== undefined) {
		return fastdom.mutate(callback);
	}
	return callback();
};

/* Facade for queueing DOM read operations
 * with Fastdom (https://github.com/wilsonpage/fastdom)
 * if available.
 * This could easily be extended to support alternate
 * implementations in the future.
 */
nv.dom.read = function(callback) {
	if (window.fastdom !== undefined) {
		return fastdom.measure(callback);
	}
	return callback();
};
/* Utility class to handle creation of an interactive layer.
 This places a rectangle on top of the chart. When you mouse move over it, it sends a dispatch
 containing the X-coordinate. It can also render a vertical line where the mouse is located.

 dispatch.elementMousemove is the important event to latch onto.  It is fired whenever the mouse moves over
 the rectangle. The dispatch is given one object which contains the mouseX/Y location.
 It also has 'pointXValue', which is the conversion of mouseX to the x-axis scale.
 */
nv.interactiveGuideline = function() {
    "use strict";

    var margin = { left: 0, top: 0 } //Pass the chart's top and left magins. Used to calculate the mouseX/Y.
        ,   width = null
        ,   height = null
        ,   xScale = d3.scale.linear()
        ,   dispatch = d3.dispatch('elementMousemove', 'elementMouseout', 'elementClick', 'elementDblclick', 'elementMouseDown', 'elementMouseUp')
        ,   showGuideLine = true
        ,   svgContainer = null // Must pass the chart's svg, we'll use its mousemove event.
        ,   tooltip = nv.models.tooltip()
        ,   isMSIE =  window.ActiveXObject// Checkt if IE by looking for activeX. (excludes IE11)
    ;

    tooltip
        .duration(0)
        .hideDelay(0)
        .hidden(false);

    function layer(selection) {
        selection.each(function(data) {
            var container = d3.select(this);
            var availableWidth = (width || 960), availableHeight = (height || 400);
            var wrap = container.selectAll("g.nv-wrap.nv-interactiveLineLayer")
                .data([data]);
            var wrapEnter = wrap.enter()
                .append("g").attr("class", " nv-wrap nv-interactiveLineLayer");
            wrapEnter.append("g").attr("class","nv-interactiveGuideLine");

            if (!svgContainer) {
                return;
            }

            function mouseHandler() {
                var d3mouse = d3.mouse(this);
                var mouseX = d3mouse[0];
                var mouseY = d3mouse[1];
                var subtractMargin = true;
                var mouseOutAnyReason = false;
                if (isMSIE) {
                    /*
                     D3.js (or maybe SVG.getScreenCTM) has a nasty bug in Internet Explorer 10.
                     d3.mouse() returns incorrect X,Y mouse coordinates when mouse moving
                     over a rect in IE 10.
                     However, d3.event.offsetX/Y also returns the mouse coordinates
                     relative to the triggering <rect>. So we use offsetX/Y on IE.
                     */
                    mouseX = d3.event.offsetX;
                    mouseY = d3.event.offsetY;

                    /*
                     On IE, if you attach a mouse event listener to the <svg> container,
                     it will actually trigger it for all the child elements (like <path>, <circle>, etc).
                     When this happens on IE, the offsetX/Y is set to where ever the child element
                     is located.
                     As a result, we do NOT need to subtract margins to figure out the mouse X/Y
                     position under this scenario. Removing the line below *will* cause
                     the interactive layer to not work right on IE.
                     */
                    if(d3.event.target.tagName !== "svg") {
                        subtractMargin = false;
                    }

                    if (d3.event.target.className.baseVal.match("nv-legend")) {
                        mouseOutAnyReason = true;
                    }

                }

                if(subtractMargin) {
                    mouseX -= margin.left;
                    mouseY -= margin.top;
                }

                /* If mouseX/Y is outside of the chart's bounds,
                 trigger a mouseOut event.
                 */
                if (d3.event.type === 'mouseout'
                    || mouseX < 0 || mouseY < 0
                    || mouseX > availableWidth || mouseY > availableHeight
                    || (d3.event.relatedTarget && d3.event.relatedTarget.ownerSVGElement === undefined)
                    || mouseOutAnyReason
                    ) {

                    if (isMSIE) {
                        if (d3.event.relatedTarget
                            && d3.event.relatedTarget.ownerSVGElement === undefined
                            && (d3.event.relatedTarget.className === undefined
                                || d3.event.relatedTarget.className.match(tooltip.nvPointerEventsClass))) {

                            return;
                        }
                    }
                    dispatch.elementMouseout({
                        mouseX: mouseX,
                        mouseY: mouseY
                    });
                    layer.renderGuideLine(null); //hide the guideline
                    tooltip.hidden(true);
                    return;
                } else {
                    tooltip.hidden(false);
                }


                var scaleIsOrdinal = typeof xScale.rangeBands === 'function';
                var pointXValue = undefined;

                // Ordinal scale has no invert method
                if (scaleIsOrdinal) {
                    var elementIndex = d3.bisect(xScale.range(), mouseX) - 1;
                    // Check if mouseX is in the range band
                    if (xScale.range()[elementIndex] + xScale.rangeBand() >= mouseX) {
                        pointXValue = xScale.domain()[d3.bisect(xScale.range(), mouseX) - 1];
                    }
                    else {
                        dispatch.elementMouseout({
                            mouseX: mouseX,
                            mouseY: mouseY
                        });
                        layer.renderGuideLine(null); //hide the guideline
                        tooltip.hidden(true);
                        return;
                    }
                }
                else {
                    pointXValue = xScale.invert(mouseX);
                }

                dispatch.elementMousemove({
                    mouseX: mouseX,
                    mouseY: mouseY,
                    pointXValue: pointXValue
                });

                //If user double clicks the layer, fire a elementDblclick
                if (d3.event.type === "dblclick") {
                    dispatch.elementDblclick({
                        mouseX: mouseX,
                        mouseY: mouseY,
                        pointXValue: pointXValue
                    });
                }

                // if user single clicks the layer, fire elementClick
                if (d3.event.type === 'click') {
                    dispatch.elementClick({
                        mouseX: mouseX,
                        mouseY: mouseY,
                        pointXValue: pointXValue
                    });
                }

                // if user presses mouse down the layer, fire elementMouseDown
                if (d3.event.type === 'mousedown') {
                	dispatch.elementMouseDown({
                		mouseX: mouseX,
                		mouseY: mouseY,
                		pointXValue: pointXValue
                	});
                }

                // if user presses mouse down the layer, fire elementMouseUp
                if (d3.event.type === 'mouseup') {
                	dispatch.elementMouseUp({
                		mouseX: mouseX,
                		mouseY: mouseY,
                		pointXValue: pointXValue
                	});
                }
            }

            svgContainer
                .on("touchmove",mouseHandler)
                .on("mousemove",mouseHandler, true)
                .on("mouseout" ,mouseHandler,true)
                .on("mousedown" ,mouseHandler,true)
                .on("mouseup" ,mouseHandler,true)
                .on("dblclick" ,mouseHandler)
                .on("click", mouseHandler)
            ;

            layer.guideLine = null;
            //Draws a vertical guideline at the given X postion.
            layer.renderGuideLine = function(x) {
                if (!showGuideLine) return;
                if (layer.guideLine && layer.guideLine.attr("x1") === x) return;
                nv.dom.write(function() {
                    var line = wrap.select(".nv-interactiveGuideLine")
                        .selectAll("line")
                        .data((x != null) ? [nv.utils.NaNtoZero(x)] : [], String);
                    line.enter()
                        .append("line")
                        .attr("class", "nv-guideline")
                        .attr("x1", function(d) { return d;})
                        .attr("x2", function(d) { return d;})
                        .attr("y1", availableHeight)
                        .attr("y2",0);
                    line.exit().remove();
                });
            }
        });
    }

    layer.dispatch = dispatch;
    layer.tooltip = tooltip;

    layer.margin = function(_) {
        if (!arguments.length) return margin;
        margin.top    = typeof _.top    != 'undefined' ? _.top    : margin.top;
        margin.left   = typeof _.left   != 'undefined' ? _.left   : margin.left;
        return layer;
    };

    layer.width = function(_) {
        if (!arguments.length) return width;
        width = _;
        return layer;
    };

    layer.height = function(_) {
        if (!arguments.length) return height;
        height = _;
        return layer;
    };

    layer.xScale = function(_) {
        if (!arguments.length) return xScale;
        xScale = _;
        return layer;
    };

    layer.showGuideLine = function(_) {
        if (!arguments.length) return showGuideLine;
        showGuideLine = _;
        return layer;
    };

    layer.svgContainer = function(_) {
        if (!arguments.length) return svgContainer;
        svgContainer = _;
        return layer;
    };

    return layer;
};

/* Utility class that uses d3.bisect to find the index in a given array, where a search value can be inserted.
 This is different from normal bisectLeft; this function finds the nearest index to insert the search value.

 For instance, lets say your array is [1,2,3,5,10,30], and you search for 28.
 Normal d3.bisectLeft will return 4, because 28 is inserted after the number 10.  But interactiveBisect will return 5
 because 28 is closer to 30 than 10.

 Unit tests can be found in: interactiveBisectTest.html

 Has the following known issues:
 * Will not work if the data points move backwards (ie, 10,9,8,7, etc) or if the data points are in random order.
 * Won't work if there are duplicate x coordinate values.
 */
nv.interactiveBisect = function (values, searchVal, xAccessor) {
    "use strict";
    if (! (values instanceof Array)) {
        return null;
    }
    var _xAccessor;
    if (typeof xAccessor !== 'function') {
        _xAccessor = function(d) {
            return d.x;
        }
    } else {
        _xAccessor = xAccessor;
    }
    var _cmp = function(d, v) {
        // Accessors are no longer passed the index of the element along with
        // the element itself when invoked by d3.bisector.
        //
        // Starting at D3 v3.4.4, d3.bisector() started inspecting the
        // function passed to determine if it should consider it an accessor
        // or a comparator. This meant that accessors that take two arguments
        // (expecting an index as the second parameter) are treated as
        // comparators where the second argument is the search value against
        // which the first argument is compared.
        return _xAccessor(d) - v;
    };

    var bisect = d3.bisector(_cmp).left;
    var index = d3.max([0, bisect(values,searchVal) - 1]);
    var currentValue = _xAccessor(values[index]);

    if (typeof currentValue === 'undefined') {
        currentValue = index;
    }

    if (currentValue === searchVal) {
        return index; //found exact match
    }

    var nextIndex = d3.min([index+1, values.length - 1]);
    var nextValue = _xAccessor(values[nextIndex]);

    if (typeof nextValue === 'undefined') {
        nextValue = nextIndex;
    }

    if (Math.abs(nextValue - searchVal) >= Math.abs(currentValue - searchVal)) {
        return index;
    } else {
        return nextIndex
    }
};

/*
 Returns the index in the array "values" that is closest to searchVal.
 Only returns an index if searchVal is within some "threshold".
 Otherwise, returns null.
 */
nv.nearestValueIndex = function (values, searchVal, threshold) {
    "use strict";
    var yDistMax = Infinity, indexToHighlight = null;
    values.forEach(function(d,i) {
        var delta = Math.abs(searchVal - d);
        if ( d != null && delta <= yDistMax && delta < threshold) {
            yDistMax = delta;
            indexToHighlight = i;
        }
    });
    return indexToHighlight;
};

/* Model which can be instantiated to handle tooltip rendering.
 Example usage:
 var tip = nv.models.tooltip().gravity('w').distance(23)
 .data(myDataObject);

 tip();    //just invoke the returned function to render tooltip.
 */
nv.models.tooltip = function() {
    "use strict";

    /*
    Tooltip data. If data is given in the proper format, a consistent tooltip is generated.
    Example Format of data:
    {
        key: "Date",
        value: "August 2009",
        series: [
            {key: "Series 1", value: "Value 1", color: "#000"},
            {key: "Series 2", value: "Value 2", color: "#00f"}
        ]
    }
    */
    var id = "nvtooltip-" + Math.floor(Math.random() * 100000) // Generates a unique id when you create a new tooltip() object.
        ,   data = null
        ,   gravity = 'w'   // Can be 'n','s','e','w'. Determines how tooltip is positioned.
        ,   distance = 25 // Distance to offset tooltip from the mouse location.
        ,   snapDistance = 0   // Tolerance allowed before tooltip is moved from its current position (creates 'snapping' effect)
        ,   classes = null  // Attaches additional CSS classes to the tooltip DIV that is created.
        ,   hidden = true  // Start off hidden, toggle with hide/show functions below.
        ,   hideDelay = 200  // Delay (in ms) before the tooltip hides after calling hide().
        ,   tooltip = null // d3 select of the tooltip div.
        ,   lastPosition = { left: null, top: null } // Last position the tooltip was in.
        ,   enabled = true  // True -> tooltips are rendered. False -> don't render tooltips.
        ,   duration = 100 // Tooltip movement duration, in ms.
        ,   headerEnabled = true // If is to show the tooltip header.
        ,   nvPointerEventsClass = "nv-pointer-events-none" // CSS class to specify whether element should not have mouse events.
    ;

    // Format function for the tooltip values column.
    var valueFormatter = function(d, i) {
        return d;
    };

    // Format function for the tooltip header value.
    var headerFormatter = function(d) {
        return d;
    };

    var keyFormatter = function(d, i) {
        return d;
    };

    // By default, the tooltip model renders a beautiful table inside a DIV.
    // You can override this function if a custom tooltip is desired.
    var contentGenerator = function(d) {
        if (d === null) {
            return '';
        }

        var table = d3.select(document.createElement("table"));
        if (headerEnabled) {
            var theadEnter = table.selectAll("thead")
                .data([d])
                .enter().append("thead");

            theadEnter.append("tr")
                .append("td")
                .attr("colspan", 3)
                .append("strong")
                .classed("x-value", true)
                .html(headerFormatter(d.value));
        }

        var tbodyEnter = table.selectAll("tbody")
            .data([d])
            .enter().append("tbody");

        var trowEnter = tbodyEnter.selectAll("tr")
                .data(function(p) { return p.series})
                .enter()
                .append("tr")
                .classed("highlight", function(p) { return p.highlight});

        trowEnter.append("td")
            .classed("legend-color-guide",true)
            .append("div")
            .style("background-color", function(p) { return p.color});

        trowEnter.append("td")
            .classed("key",true)
            .classed("total",function(p) { return !!p.total})
            .html(function(p, i) { return keyFormatter(p.key, i)});

        trowEnter.append("td")
            .classed("value",true)
            .html(function(p, i) { return valueFormatter(p.value, i) });

        trowEnter.filter(function (p,i) { return p.percent !== undefined }).append("td")
            .classed("percent", true)
            .html(function(p, i) { return "(" + d3.format('%')(p.percent) + ")" });

        trowEnter.selectAll("td").each(function(p) {
            if (p.highlight) {
                var opacityScale = d3.scale.linear().domain([0,1]).range(["#fff",p.color]);
                var opacity = 0.6;
                d3.select(this)
                    .style("border-bottom-color", opacityScale(opacity))
                    .style("border-top-color", opacityScale(opacity))
                ;
            }
        });

        var html = table.node().outerHTML;
        if (d.footer !== undefined)
            html += "<div class='footer'>" + d.footer + "</div>";
        return html;

    };

    /*
     Function that returns the position (relative to the viewport/document.body)
     the tooltip should be placed in.
     Should return: {
        left: <leftPos>,
        top: <topPos>
     }
     */
    var position = function() {
        var pos = {
            left: d3.event !== null ? d3.event.clientX : 0,
            top: d3.event !== null ? d3.event.clientY : 0
        };

        if(getComputedStyle(document.body).transform != 'none') {
            // Take the offset into account, as now the tooltip is relative
            // to document.body.
            var client = document.body.getBoundingClientRect();
            pos.left -= client.left;
            pos.top -= client.top;
        }

        return pos;
    };

    var dataSeriesExists = function(d) {
        if (d && d.series) {
            if (nv.utils.isArray(d.series)) {
                return true;
            }
            // if object, it's okay just convert to array of the object
            if (nv.utils.isObject(d.series)) {
                d.series = [d.series];
                return true;
            }
        }
        return false;
    };

    // Calculates the gravity offset of the tooltip. Parameter is position of tooltip
    // relative to the viewport.
    var calcGravityOffset = function(pos) {
        var height = tooltip.node().offsetHeight,
            width = tooltip.node().offsetWidth,
            clientWidth = document.documentElement.clientWidth, // Don't want scrollbars.
            clientHeight = document.documentElement.clientHeight, // Don't want scrollbars.
            left, top, tmp;

        // calculate position based on gravity
        switch (gravity) {
            case 'e':
                left = - width - distance;
                top = - (height / 2);
                if(pos.left + left < 0) left = distance;
                if((tmp = pos.top + top) < 0) top -= tmp;
                if((tmp = pos.top + top + height) > clientHeight) top -= tmp - clientHeight;
                break;
            case 'w':
                left = distance;
                top = - (height / 2);
                if (pos.left + left + width > clientWidth) left = - width - distance;
                if ((tmp = pos.top + top) < 0) top -= tmp;
                if ((tmp = pos.top + top + height) > clientHeight) top -= tmp - clientHeight;
                break;
            case 'n':
                left = - (width / 2) - 5; // - 5 is an approximation of the mouse's height.
                top = distance;
                if (pos.top + top + height > clientHeight) top = - height - distance;
                if ((tmp = pos.left + left) < 0) left -= tmp;
                if ((tmp = pos.left + left + width) > clientWidth) left -= tmp - clientWidth;
                break;
            case 's':
                left = - (width / 2);
                top = - height - distance;
                if (pos.top + top < 0) top = distance;
                if ((tmp = pos.left + left) < 0) left -= tmp;
                if ((tmp = pos.left + left + width) > clientWidth) left -= tmp - clientWidth;
                break;
            case 'center':
                left = - (width / 2);
                top = - (height / 2);
                break;
            default:
                left = 0;
                top = 0;
                break;
        }

        return { 'left': left, 'top': top };
    };

    /*
     Positions the tooltip in the correct place, as given by the position() function.
     */
    var positionTooltip = function() {
        nv.dom.read(function() {
            var pos = position(),
                gravityOffset = calcGravityOffset(pos),
                left = pos.left + gravityOffset.left,
                top = pos.top + gravityOffset.top;

            // delay hiding a bit to avoid flickering
            if (hidden) {
                tooltip
                    .interrupt()
                    .transition()
                    .delay(hideDelay)
                    .duration(0)
                    .style('opacity', 0);
            } else {
                // using tooltip.style('transform') returns values un-usable for tween
                var old_translate = 'translate(' + lastPosition.left + 'px, ' + lastPosition.top + 'px)';
                var new_translate = 'translate(' + Math.round(left) + 'px, ' + Math.round(top) + 'px)';
                var translateInterpolator = d3.interpolateString(old_translate, new_translate);
                var is_hidden = tooltip.style('opacity') < 0.1;

                tooltip
                    .interrupt() // cancel running transitions
                    .transition()
                    .duration(is_hidden ? 0 : duration)
                    // using tween since some versions of d3 can't auto-tween a translate on a div
                    .styleTween('transform', function (d) {
                        return translateInterpolator;
                    }, 'important')
                    // Safari has its own `-webkit-transform` and does not support `transform`
                    .styleTween('-webkit-transform', function (d) {
                        return translateInterpolator;
                    })
                    .style('-ms-transform', new_translate)
                    .style('opacity', 1);
            }

            lastPosition.left = left;
            lastPosition.top = top;
        });
    };

    // Creates new tooltip container, or uses existing one on DOM.
    function initTooltip() {
        if (!tooltip || !tooltip.node()) {
            // Create new tooltip div if it doesn't exist on DOM.

            var data = [1];
            tooltip = d3.select(document.body).select('#'+id).data(data);

            tooltip.enter().append('div')
                   .attr("class", "nvtooltip " + (classes ? classes : "xy-tooltip"))
                   .attr("id", id)
                   .style("top", 0).style("left", 0)
                   .style('opacity', 0)
                   .style('position', 'fixed')
                   .selectAll("div, table, td, tr").classed(nvPointerEventsClass, true)
                   .classed(nvPointerEventsClass, true);

            tooltip.exit().remove()
        }
    }

    // Draw the tooltip onto the DOM.
    function nvtooltip() {
        if (!enabled) return;
        if (!dataSeriesExists(data)) return;

        nv.dom.write(function () {
            initTooltip();
            // Generate data and set it into tooltip.
            // Bonus - If you override contentGenerator and return falsey you can use something like
            //         React or Knockout to bind the data for your tooltip.
            var newContent = contentGenerator(data);
            if (newContent) {
                tooltip.node().innerHTML = newContent;
            }

            positionTooltip();
        });

        return nvtooltip;
    }

    nvtooltip.nvPointerEventsClass = nvPointerEventsClass;
    nvtooltip.options = nv.utils.optionsFunc.bind(nvtooltip);

    nvtooltip._options = Object.create({}, {
        // simple read/write options
        duration: {get: function(){return duration;}, set: function(_){duration=_;}},
        gravity: {get: function(){return gravity;}, set: function(_){gravity=_;}},
        distance: {get: function(){return distance;}, set: function(_){distance=_;}},
        snapDistance: {get: function(){return snapDistance;}, set: function(_){snapDistance=_;}},
        classes: {get: function(){return classes;}, set: function(_){classes=_;}},
        enabled: {get: function(){return enabled;}, set: function(_){enabled=_;}},
        hideDelay: {get: function(){return hideDelay;}, set: function(_){hideDelay=_;}},
        contentGenerator: {get: function(){return contentGenerator;}, set: function(_){contentGenerator=_;}},
        valueFormatter: {get: function(){return valueFormatter;}, set: function(_){valueFormatter=_;}},
        headerFormatter: {get: function(){return headerFormatter;}, set: function(_){headerFormatter=_;}},
        keyFormatter: {get: function(){return keyFormatter;}, set: function(_){keyFormatter=_;}},
        headerEnabled: {get: function(){return headerEnabled;}, set: function(_){headerEnabled=_;}},
        position: {get: function(){return position;}, set: function(_){position=_;}},

        // Deprecated options
        chartContainer: {get: function(){return document.body;}, set: function(_){
            // deprecated after 1.8.3
            nv.deprecated('chartContainer', 'feature removed after 1.8.3');
        }},
        fixedTop: {get: function(){return null;}, set: function(_){
            // deprecated after 1.8.1
            nv.deprecated('fixedTop', 'feature removed after 1.8.1');
        }},
        offset: {get: function(){return {left: 0, top: 0};}, set: function(_){
            // deprecated after 1.8.1
            nv.deprecated('offset', 'use chart.tooltip.distance() instead');
        }},

        // options with extra logic
        hidden: {get: function(){return hidden;}, set: function(_){
            if (hidden != _) {
                hidden = !!_;
                nvtooltip();
            }
        }},
        data: {get: function(){return data;}, set: function(_){
            // if showing a single data point, adjust data format with that
            if (_.point) {
                _.value = _.point.x;
                _.series = _.series || {};
                _.series.value = _.point.y;
                _.series.color = _.point.color || _.series.color;
            }
            data = _;
        }},

        // read only properties
        node: {get: function(){return tooltip.node();}, set: function(_){}},
        id: {get: function(){return id;}, set: function(_){}}
    });

    nv.utils.initOptions(nvtooltip);
    return nvtooltip;
};


/*
Gets the browser window size

Returns object with height and width properties
 */
nv.utils.windowSize = function() {
    // Sane defaults
    var size = {width: 640, height: 480};

    // Most recent browsers use
    if (window.innerWidth && window.innerHeight) {
        size.width = window.innerWidth;
        size.height = window.innerHeight;
        return (size);
    }

    // IE can use depending on mode it is in
    if (document.compatMode=='CSS1Compat' &&
        document.documentElement &&
        document.documentElement.offsetWidth ) {

        size.width = document.documentElement.offsetWidth;
        size.height = document.documentElement.offsetHeight;
        return (size);
    }

    // Earlier IE uses Doc.body
    if (document.body && document.body.offsetWidth) {
        size.width = document.body.offsetWidth;
        size.height = document.body.offsetHeight;
        return (size);
    }

    return (size);
};


/* handle dumb browser quirks...  isinstance breaks if you use frames
typeof returns 'object' for null, NaN is a number, etc.
 */
nv.utils.isArray = Array.isArray;
nv.utils.isObject = function(a) {
    return a !== null && typeof a === 'object';
};
nv.utils.isFunction = function(a) {
    return typeof a === 'function';
};
nv.utils.isDate = function(a) {
    return toString.call(a) === '[object Date]';
};
nv.utils.isNumber = function(a) {
    return !isNaN(a) && typeof a === 'number';
};


/*
Binds callback function to run when window is resized
 */
nv.utils.windowResize = function(handler) {
    if (window.addEventListener) {
        window.addEventListener('resize', handler);
    } else {
        nv.log("ERROR: Failed to bind to window.resize with: ", handler);
    }
    // return object with clear function to remove the single added callback.
    return {
        callback: handler,
        clear: function() {
            window.removeEventListener('resize', handler);
        }
    }
};


/*
Backwards compatible way to implement more d3-like coloring of graphs.
Can take in nothing, an array, or a function/scale
To use a normal scale, get the range and pass that because we must be able
to take two arguments and use the index to keep backward compatibility
*/
nv.utils.getColor = function(color) {
    //if you pass in nothing, get default colors back
    if (color === undefined) {
        return nv.utils.defaultColor();

    //if passed an array, turn it into a color scale
    } else if(nv.utils.isArray(color)) {
        var color_scale = d3.scale.ordinal().range(color);
        return function(d, i) {
            var key = i === undefined ? d : i;
            return d.color || color_scale(key);
        };

    //if passed a function or scale, return it, or whatever it may be
    //external libs, such as angularjs-nvd3-directives use this
    } else {
        //can't really help it if someone passes rubbish as color
        return color;
    }
};


/*
Default color chooser uses a color scale of 20 colors from D3
 https://github.com/mbostock/d3/wiki/Ordinal-Scales#categorical-colors
 */
nv.utils.defaultColor = function() {
    // get range of the scale so we'll turn it into our own function.
    return nv.utils.getColor(d3.scale.category20().range());
};


/*
Returns a color function that takes the result of 'getKey' for each series and
looks for a corresponding color from the dictionary
*/
nv.utils.customTheme = function(dictionary, getKey, defaultColors) {
    // use default series.key if getKey is undefined
    getKey = getKey || function(series) { return series.key };
    defaultColors = defaultColors || d3.scale.category20().range();

    // start at end of default color list and walk back to index 0
    var defIndex = defaultColors.length;

    return function(series, index) {
        var key = getKey(series);
        if (nv.utils.isFunction(dictionary[key])) {
            return dictionary[key]();
        } else if (dictionary[key] !== undefined) {
            return dictionary[key];
        } else {
            // no match in dictionary, use a default color
            if (!defIndex) {
                // used all the default colors, start over
                defIndex = defaultColors.length;
            }
            defIndex = defIndex - 1;
            return defaultColors[defIndex];
        }
    };
};


/*
From the PJAX example on d3js.org, while this is not really directly needed
it's a very cool method for doing pjax, I may expand upon it a little bit,
open to suggestions on anything that may be useful
*/
nv.utils.pjax = function(links, content) {

    var load = function(href) {
        d3.html(href, function(fragment) {
            var target = d3.select(content).node();
            target.parentNode.replaceChild(
                d3.select(fragment).select(content).node(),
                target);
            nv.utils.pjax(links, content);
        });
    };

    d3.selectAll(links).on("click", function() {
        history.pushState(this.href, this.textContent, this.href);
        load(this.href);
        d3.event.preventDefault();
    });

    d3.select(window).on("popstate", function() {
        if (d3.event.state) {
            load(d3.event.state);
        }
    });
};


/*
For when we want to approximate the width in pixels for an SVG:text element.
Most common instance is when the element is in a display:none; container.
Forumla is : text.length * font-size * constant_factor
*/
nv.utils.calcApproxTextWidth = function (svgTextElem) {
    if (nv.utils.isFunction(svgTextElem.style) && nv.utils.isFunction(svgTextElem.text)) {
        var fontSize = parseInt(svgTextElem.style("font-size").replace("px",""), 10);
        var textLength = svgTextElem.text().length;
        return nv.utils.NaNtoZero(textLength * fontSize * 0.5);
    }
    return 0;
};


/*
Numbers that are undefined, null or NaN, convert them to zeros.
*/
nv.utils.NaNtoZero = function(n) {
    if (!nv.utils.isNumber(n)
        || isNaN(n)
        || n === null
        || n === Infinity
        || n === -Infinity) {

        return 0;
    }
    return n;
};

/*
Add a way to watch for d3 transition ends to d3
*/
d3.selection.prototype.watchTransition = function(renderWatch){
    var args = [this].concat([].slice.call(arguments, 1));
    return renderWatch.transition.apply(renderWatch, args);
};


/*
Helper object to watch when d3 has rendered something
*/
nv.utils.renderWatch = function(dispatch, duration) {
    if (!(this instanceof nv.utils.renderWatch)) {
        return new nv.utils.renderWatch(dispatch, duration);
    }

    var _duration = duration !== undefined ? duration : 250;
    var renderStack = [];
    var self = this;

    this.models = function(models) {
        models = [].slice.call(arguments, 0);
        models.forEach(function(model){
            model.__rendered = false;
            (function(m){
                m.dispatch.on('renderEnd', function(arg){
                    m.__rendered = true;
                    self.renderEnd('model');
                });
            })(model);

            if (renderStack.indexOf(model) < 0) {
                renderStack.push(model);
            }
        });
    return this;
    };

    this.reset = function(duration) {
        if (duration !== undefined) {
            _duration = duration;
        }
        renderStack = [];
    };

    this.transition = function(selection, args, duration) {
        args = arguments.length > 1 ? [].slice.call(arguments, 1) : [];

        if (args.length > 1) {
            duration = args.pop();
        } else {
            duration = _duration !== undefined ? _duration : 250;
        }
        selection.__rendered = false;

        if (renderStack.indexOf(selection) < 0) {
            renderStack.push(selection);
        }

        if (duration === 0) {
            selection.__rendered = true;
            selection.delay = function() { return this; };
            selection.duration = function() { return this; };
            return selection;
        } else {
            if (selection.length === 0) {
                selection.__rendered = true;
            } else if (selection.every( function(d){ return !d.length; } )) {
                selection.__rendered = true;
            } else {
                selection.__rendered = false;
            }

            var n = 0;
            return selection
                .transition()
                .duration(duration)
                .each(function(){ ++n; })
                .each('end', function(d, i) {
                    if (--n === 0) {
                        selection.__rendered = true;
                        self.renderEnd.apply(this, args);
                    }
                });
        }
    };

    this.renderEnd = function() {
        if (renderStack.every( function(d){ return d.__rendered; } )) {
            renderStack.forEach( function(d){ d.__rendered = false; });
            dispatch.renderEnd.apply(this, arguments);
        }
    }

};


/*
Takes multiple objects and combines them into the first one (dst)
example:  nv.utils.deepExtend({a: 1}, {a: 2, b: 3}, {c: 4});
gives:  {a: 2, b: 3, c: 4}
*/
nv.utils.deepExtend = function(dst){
    var sources = arguments.length > 1 ? [].slice.call(arguments, 1) : [];
    sources.forEach(function(source) {
        for (var key in source) {
            var isArray = nv.utils.isArray(dst[key]);
            var isObject = nv.utils.isObject(dst[key]);
            var srcObj = nv.utils.isObject(source[key]);

            if (isObject && !isArray && srcObj) {
                nv.utils.deepExtend(dst[key], source[key]);
            } else {
                dst[key] = source[key];
            }
        }
    });
};


/*
state utility object, used to track d3 states in the models
*/
nv.utils.state = function(){
    if (!(this instanceof nv.utils.state)) {
        return new nv.utils.state();
    }
    var state = {};
    var _self = this;
    var _setState = function(){};
    var _getState = function(){ return {}; };
    var init = null;
    var changed = null;

    this.dispatch = d3.dispatch('change', 'set');

    this.dispatch.on('set', function(state){
        _setState(state, true);
    });

    this.getter = function(fn){
        _getState = fn;
        return this;
    };

    this.setter = function(fn, callback) {
        if (!callback) {
            callback = function(){};
        }
        _setState = function(state, update){
            fn(state);
            if (update) {
                callback();
            }
        };
        return this;
    };

    this.init = function(state){
        init = init || {};
        nv.utils.deepExtend(init, state);
    };

    var _set = function(){
        var settings = _getState();

        if (JSON.stringify(settings) === JSON.stringify(state)) {
            return false;
        }

        for (var key in settings) {
            if (state[key] === undefined) {
                state[key] = {};
            }
            state[key] = settings[key];
            changed = true;
        }
        return true;
    };

    this.update = function(){
        if (init) {
            _setState(init, false);
            init = null;
        }
        if (_set.call(this)) {
            this.dispatch.change(state);
        }
    };

};


/*
Snippet of code you can insert into each nv.models.* to give you the ability to
do things like:
chart.options({
  showXAxis: true,
  tooltips: true
});

To enable in the chart:
chart.options = nv.utils.optionsFunc.bind(chart);
*/
nv.utils.optionsFunc = function(args) {
    if (args) {
        d3.map(args).forEach((function(key,value) {
            if (nv.utils.isFunction(this[key])) {
                this[key](value);
            }
        }).bind(this));
    }
    return this;
};


/*
numTicks:  requested number of ticks
data:  the chart data

returns the number of ticks to actually use on X axis, based on chart data
to avoid duplicate ticks with the same value
*/
nv.utils.calcTicksX = function(numTicks, data) {
    // find max number of values from all data streams
    var numValues = 1;
    var i = 0;
    for (i; i < data.length; i += 1) {
        var stream_len = data[i] && data[i].values ? data[i].values.length : 0;
        numValues = stream_len > numValues ? stream_len : numValues;
    }
    nv.log("Requested number of ticks: ", numTicks);
    nv.log("Calculated max values to be: ", numValues);
    // make sure we don't have more ticks than values to avoid duplicates
    numTicks = numTicks > numValues ? numTicks = numValues - 1 : numTicks;
    // make sure we have at least one tick
    numTicks = numTicks < 1 ? 1 : numTicks;
    // make sure it's an integer
    numTicks = Math.floor(numTicks);
    nv.log("Calculating tick count as: ", numTicks);
    return numTicks;
};


/*
returns number of ticks to actually use on Y axis, based on chart data
*/
nv.utils.calcTicksY = function(numTicks, data) {
    // currently uses the same logic but we can adjust here if needed later
    return nv.utils.calcTicksX(numTicks, data);
};


/*
Add a particular option from an options object onto chart
Options exposed on a chart are a getter/setter function that returns chart
on set to mimic typical d3 option chaining, e.g. svg.option1('a').option2('b');

option objects should be generated via Object.create() to provide
the option of manipulating data via get/set functions.
*/
nv.utils.initOption = function(chart, name) {
    // if it's a call option, just call it directly, otherwise do get/set
    if (chart._calls && chart._calls[name]) {
        chart[name] = chart._calls[name];
    } else {
        chart[name] = function (_) {
            if (!arguments.length) return chart._options[name];
            chart._overrides[name] = true;
            chart._options[name] = _;
            return chart;
        };
        // calling the option as _option will ignore if set by option already
        // so nvd3 can set options internally but the stop if set manually
        chart['_' + name] = function(_) {
            if (!arguments.length) return chart._options[name];
            if (!chart._overrides[name]) {
                chart._options[name] = _;
            }
            return chart;
        }
    }
};


/*
Add all options in an options object to the chart
*/
nv.utils.initOptions = function(chart) {
    chart._overrides = chart._overrides || {};
    var ops = Object.getOwnPropertyNames(chart._options || {});
    var calls = Object.getOwnPropertyNames(chart._calls || {});
    ops = ops.concat(calls);
    for (var i in ops) {
        nv.utils.initOption(chart, ops[i]);
    }
};


/*
Inherit options from a D3 object
d3.rebind makes calling the function on target actually call it on source
Also use _d3options so we can track what we inherit for documentation and chained inheritance
*/
nv.utils.inheritOptionsD3 = function(target, d3_source, oplist) {
    target._d3options = oplist.concat(target._d3options || []);
    oplist.unshift(d3_source);
    oplist.unshift(target);
    d3.rebind.apply(this, oplist);
};


/*
Remove duplicates from an array
*/
nv.utils.arrayUnique = function(a) {
    return a.sort().filter(function(item, pos) {
        return !pos || item != a[pos - 1];
    });
};


/*
Keeps a list of custom symbols to draw from in addition to d3.svg.symbol
Necessary since d3 doesn't let you extend its list -_-
Add new symbols by doing nv.utils.symbols.set('name', function(size){...});
*/
nv.utils.symbolMap = d3.map();


/*
Replaces d3.svg.symbol so that we can look both there and our own map
 */
nv.utils.symbol = function() {
    var type,
        size = 64;
    function symbol(d,i) {
        var t = type.call(this,d,i);
        var s = size.call(this,d,i);
        if (d3.svg.symbolTypes.indexOf(t) !== -1) {
            return d3.svg.symbol().type(t).size(s)();
        } else {
            return nv.utils.symbolMap.get(t)(s);
        }
    }
    symbol.type = function(_) {
        if (!arguments.length) return type;
        type = d3.functor(_);
        return symbol;
    };
    symbol.size = function(_) {
        if (!arguments.length) return size;
        size = d3.functor(_);
        return symbol;
    };
    return symbol;
};


/*
Inherit option getter/setter functions from source to target
d3.rebind makes calling the function on target actually call it on source
Also track via _inherited and _d3options so we can track what we inherit
for documentation generation purposes and chained inheritance
*/
nv.utils.inheritOptions = function(target, source) {
    // inherit all the things
    var ops = Object.getOwnPropertyNames(source._options || {});
    var calls = Object.getOwnPropertyNames(source._calls || {});
    var inherited = source._inherited || [];
    var d3ops = source._d3options || [];
    var args = ops.concat(calls).concat(inherited).concat(d3ops);
    args.unshift(source);
    args.unshift(target);
    d3.rebind.apply(this, args);
    // pass along the lists to keep track of them, don't allow duplicates
    target._inherited = nv.utils.arrayUnique(ops.concat(calls).concat(inherited).concat(ops).concat(target._inherited || []));
    target._d3options = nv.utils.arrayUnique(d3ops.concat(target._d3options || []));
};


/*
Runs common initialize code on the svg before the chart builds
*/
nv.utils.initSVG = function(svg) {
    svg.classed({'nvd3-svg':true});
};


/*
Sanitize and provide default for the container height.
*/
nv.utils.sanitizeHeight = function(height, container) {
    return (height || parseInt(container.style('height'), 10) || 400);
};


/*
Sanitize and provide default for the container width.
*/
nv.utils.sanitizeWidth = function(width, container) {
    return (width || parseInt(container.style('width'), 10) || 960);
};


/*
Calculate the available height for a chart.
*/
nv.utils.availableHeight = function(height, container, margin) {
    return Math.max(0,nv.utils.sanitizeHeight(height, container) - margin.top - margin.bottom);
};

/*
Calculate the available width for a chart.
*/
nv.utils.availableWidth = function(width, container, margin) {
    return Math.max(0,nv.utils.sanitizeWidth(width, container) - margin.left - margin.right);
};

/*
Clear any rendered chart components and display a chart's 'noData' message
*/
nv.utils.noData = function(chart, container) {
    var opt = chart.options(),
        margin = opt.margin(),
        noData = opt.noData(),
        data = (noData == null) ? ["No Data Available."] : [noData],
        height = nv.utils.availableHeight(null, container, margin),
        width = nv.utils.availableWidth(null, container, margin),
        x = margin.left + width/2,
        y = margin.top + height/2;

    //Remove any previously created chart components
    container.selectAll('g').remove();

    var noDataText = container.selectAll('.nv-noData').data(data);

    noDataText.enter().append('text')
        .attr('class', 'nvd3 nv-noData')
        .attr('dy', '-.7em')
        .style('text-anchor', 'middle');

    noDataText
        .attr('x', x)
        .attr('y', y)
        .text(function(t){ return t; });
};

/*
 Wrap long labels.
 */
nv.utils.wrapTicks = function (text, width) {
    text.each(function() {
        var text = d3.select(this),
            words = text.text().split(/\s+/).reverse(),
            word,
            line = [],
            lineNumber = 0,
            lineHeight = 1.1,
            y = text.attr("y"),
            dy = parseFloat(text.attr("dy")),
            tspan = text.text(null).append("tspan").attr("x", 0).attr("y", y).attr("dy", dy + "em");
        while (word = words.pop()) {
            line.push(word);
            tspan.text(line.join(" "));
            if (tspan.node().getComputedTextLength() > width) {
                line.pop();
                tspan.text(line.join(" "));
                line = [word];
                tspan = text.append("tspan").attr("x", 0).attr("y", y).attr("dy", ++lineNumber * lineHeight + dy + "em").text(word);
            }
        }
    });
};

/*
Check equality of 2 array
*/
nv.utils.arrayEquals = function (array1, array2) {
    if (array1 === array2)
        return true;

    if (!array1 || !array2)
        return false;

    // compare lengths - can save a lot of time
    if (array1.length != array2.length)
        return false;

    for (var i = 0,
        l = array1.length; i < l; i++) {
        // Check if we have nested arrays
        if (array1[i] instanceof Array && array2[i] instanceof Array) {
            // recurse into the nested arrays
            if (!nv.arrayEquals(array1[i], array2[i]))
                return false;
        } else if (array1[i] != array2[i]) {
            // Warning - two different object instances will never be equal: {x:20} != {x:20}
            return false;
        }
    }
    return true;
};
nv.models.lineChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var lines = nv.models.line()
        , xAxis = nv.models.axis()
        , yAxis = nv.models.axis()
        , legend = nv.models.legend()
        , interactiveLayer = nv.interactiveGuideline()
        , tooltip = nv.models.tooltip()
        , focus = nv.models.focus(nv.models.line())
        ;

    var margin = {top: 30, right: 20, bottom: 50, left: 60}
        , marginTop = null
        , color = nv.utils.defaultColor()
        , width = null
        , height = null
        , showLegend = true
        , legendPosition = 'top'
        , showXAxis = true
        , showYAxis = true
        , rightAlignYAxis = false
        , useInteractiveGuideline = false
        , x
        , y
        , focusEnable = false
        , state = nv.utils.state()
        , defaultState = null
        , noData = null
        , dispatch = d3.dispatch('tooltipShow', 'tooltipHide', 'stateChange', 'changeState', 'renderEnd')
        , duration = 250
        ;

    // set options on sub-objects for this chart
    xAxis.orient('bottom').tickPadding(7);
    yAxis.orient(rightAlignYAxis ? 'right' : 'left');

    lines.clipEdge(true).duration(0);

    tooltip.valueFormatter(function(d, i) {
        return yAxis.tickFormat()(d, i);
    }).headerFormatter(function(d, i) {
        return xAxis.tickFormat()(d, i);
    });

    interactiveLayer.tooltip.valueFormatter(function(d, i) {
        return yAxis.tickFormat()(d, i);
    }).headerFormatter(function(d, i) {
        return xAxis.tickFormat()(d, i);
    });


    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch, duration);

    var stateGetter = function(data) {
        return function(){
            return {
                active: data.map(function(d) { return !d.disabled; })
            };
        };
    };

    var stateSetter = function(data) {
        return function(state) {
            if (state.active !== undefined)
                data.forEach(function(series,i) {
                    series.disabled = !state.active[i];
                });
        };
    };

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(lines);
        if (showXAxis) renderWatch.models(xAxis);
        if (showYAxis) renderWatch.models(yAxis);

        selection.each(function(data) {
            var container = d3.select(this);
            nv.utils.initSVG(container);
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin) - (focusEnable ? focus.height() : 0);
            chart.update = function() {
                if( duration === 0 ) {
                    container.call( chart );
                } else {
                    container.transition().duration(duration).call(chart);
                }
            };
            chart.container = this;

            state
                .setter(stateSetter(data), chart.update)
                .getter(stateGetter(data))
                .update();

            // DEPRECATED set state.disabled
            state.disabled = data.map(function(d) { return !!d.disabled; });

            if (!defaultState) {
                var key;
                defaultState = {};
                for (key in state) {
                    if (state[key] instanceof Array)
                        defaultState[key] = state[key].slice(0);
                    else
                        defaultState[key] = state[key];
                }
            }

            // Display noData message if there's nothing to show.
            if (!data || !data.length || !data.filter(function(d) { return d.values.length; }).length) {
                nv.utils.noData(chart, container);
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            /* Update `main' graph on brush update. */
            focus.dispatch.on("onBrush", function(extent) {
                onBrush(extent);
            });

            // Setup Scales
            x = lines.xScale();
            y = lines.yScale();

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-lineChart').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-lineChart').append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-legendWrap');

            var focusEnter = gEnter.append('g').attr('class', 'nv-focus');
            focusEnter.append('g').attr('class', 'nv-background').append('rect');
            focusEnter.append('g').attr('class', 'nv-x nv-axis');
            focusEnter.append('g').attr('class', 'nv-y nv-axis');
            focusEnter.append('g').attr('class', 'nv-linesWrap');
            focusEnter.append('g').attr('class', 'nv-interactive');

            var contextEnter = gEnter.append('g').attr('class', 'nv-focusWrap');

            // Legend
            if (!showLegend) {
                g.select('.nv-legendWrap').selectAll('*').remove();
            } else {
                legend.width(availableWidth);

                g.select('.nv-legendWrap')
                    .datum(data)
                    .call(legend);

                if (legendPosition === 'bottom') {
                    wrap.select('.nv-legendWrap')
                        .attr('transform', 'translate(0,' + availableHeight +')');
                } else if (legendPosition === 'top') {
                    if (!marginTop && legend.height() !== margin.top) {
                        margin.top = legend.height();
                        availableHeight = nv.utils.availableHeight(height, container, margin) - (focusEnable ? focus.height() : 0);
                    }

                    wrap.select('.nv-legendWrap')
                        .attr('transform', 'translate(0,' + (-margin.top) +')');
                }
            }

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            if (rightAlignYAxis) {
                g.select(".nv-y.nv-axis")
                    .attr("transform", "translate(" + availableWidth + ",0)");
            }

            //Set up interactive layer
            if (useInteractiveGuideline) {
                interactiveLayer
                    .width(availableWidth)
                    .height(availableHeight)
                    .margin({left:margin.left, top:margin.top})
                    .svgContainer(container)
                    .xScale(x);
                wrap.select(".nv-interactive").call(interactiveLayer);
            }

            g.select('.nv-focus .nv-background rect')
                .attr('width', availableWidth)
                .attr('height', availableHeight);

            lines
                .width(availableWidth)
                .height(availableHeight)
                .color(data.map(function(d,i) {
                    return d.color || color(d, i);
                }).filter(function(d,i) { return !data[i].disabled; }));

            var linesWrap = g.select('.nv-linesWrap')
                .datum(data.filter(function(d) { return !d.disabled; }));


            // Setup Main (Focus) Axes
            if (showXAxis) {
                xAxis
                    .scale(x)
                    ._ticks(nv.utils.calcTicksX(availableWidth/100, data) )
                    .tickSize(-availableHeight, 0);
            }

            if (showYAxis) {
                yAxis
                    .scale(y)
                    ._ticks( nv.utils.calcTicksY(availableHeight/36, data) )
                    .tickSize( -availableWidth, 0);
            }

            //============================================================
            // Update Axes
            //============================================================
            function updateXAxis() {
              if(showXAxis) {
                g.select('.nv-focus .nv-x.nv-axis')
                  .transition()
                  .duration(duration)
                  .call(xAxis)
                ;
              }
            }

            function updateYAxis() {
              if(showYAxis) {
                g.select('.nv-focus .nv-y.nv-axis')
                  .transition()
                  .duration(duration)
                  .call(yAxis)
                ;
              }
            }

            g.select('.nv-focus .nv-x.nv-axis')
                .attr('transform', 'translate(0,' + availableHeight + ')');

            //============================================================
            // Update Focus
            //============================================================
            if(!focusEnable) {
                linesWrap.call(lines);
                updateXAxis();
                updateYAxis();
            } else {
                focus.width(availableWidth);
                g.select('.nv-focusWrap')
                    .attr('transform', 'translate(0,' + ( availableHeight + margin.bottom + focus.margin().top) + ')')
                    .datum(data.filter(function(d) { return !d.disabled; }))
                    .call(focus);
                var extent = focus.brush.empty() ? focus.xDomain() : focus.brush.extent();
                if(extent !== null){
                    onBrush(extent);
                }
            }
            //============================================================
            // Event Handling/Dispatching (in chart's scope)
            //------------------------------------------------------------

            legend.dispatch.on('stateChange', function(newState) {
                for (var key in newState)
                    state[key] = newState[key];
                dispatch.stateChange(state);
                chart.update();
            });

            interactiveLayer.dispatch.on('elementMousemove', function(e) {
                lines.clearHighlights();
                var singlePoint, pointIndex, pointXLocation, allData = [];
                data
                    .filter(function(series, i) {
                        series.seriesIndex = i;
                        return !series.disabled && !series.disableTooltip;
                    })
                    .forEach(function(series,i) {
                        var extent = focusEnable ? (focus.brush.empty() ? focus.xScale().domain() : focus.brush.extent()) : x.domain();
                        var currentValues = series.values.filter(function(d,i) {
                            // Checks if the x point is between the extents, handling case where extent[0] is greater than extent[1]
                            // (e.g. x domain is manually set to reverse the x-axis)
                            if(extent[0] <= extent[1]) {
                                return lines.x()(d,i) >= extent[0] && lines.x()(d,i) <= extent[1];
                            } else {
                                return lines.x()(d,i) >= extent[1] && lines.x()(d,i) <= extent[0];
                            }
                        });

                        pointIndex = nv.interactiveBisect(currentValues, e.pointXValue, lines.x());
                        var point = currentValues[pointIndex];
                        var pointYValue = chart.y()(point, pointIndex);
                        if (pointYValue !== null) {
                            lines.highlightPoint(i, pointIndex, true);
                        }
                        if (point === undefined) return;
                        if (singlePoint === undefined) singlePoint = point;
                        if (pointXLocation === undefined) pointXLocation = chart.xScale()(chart.x()(point,pointIndex));
                        allData.push({
                            key: series.key,
                            value: pointYValue,
                            color: color(series,series.seriesIndex),
                            data: point
                        });
                    });
                //Highlight the tooltip entry based on which point the mouse is closest to.
                if (allData.length > 2) {
                    var yValue = chart.yScale().invert(e.mouseY);
                    var domainExtent = Math.abs(chart.yScale().domain()[0] - chart.yScale().domain()[1]);
                    var threshold = 0.03 * domainExtent;
                    var indexToHighlight = nv.nearestValueIndex(allData.map(function(d){return d.value;}),yValue,threshold);
                    if (indexToHighlight !== null)
                        allData[indexToHighlight].highlight = true;
                }

                var defaultValueFormatter = function(d,i) {
                    return d == null ? "N/A" : yAxis.tickFormat()(d);
                };

                interactiveLayer.tooltip
                    .valueFormatter(interactiveLayer.tooltip.valueFormatter() || defaultValueFormatter)
                    .data({
                        value: chart.x()( singlePoint,pointIndex ),
                        index: pointIndex,
                        series: allData
                    })();

                interactiveLayer.renderGuideLine(pointXLocation);

            });

            interactiveLayer.dispatch.on('elementClick', function(e) {
                var pointXLocation, allData = [];

                data.filter(function(series, i) {
                    series.seriesIndex = i;
                    return !series.disabled;
                }).forEach(function(series) {
                    var pointIndex = nv.interactiveBisect(series.values, e.pointXValue, chart.x());
                    var point = series.values[pointIndex];
                    if (typeof point === 'undefined') return;
                    if (typeof pointXLocation === 'undefined') pointXLocation = chart.xScale()(chart.x()(point,pointIndex));
                    var yPos = chart.yScale()(chart.y()(point,pointIndex));
                    allData.push({
                        point: point,
                        pointIndex: pointIndex,
                        pos: [pointXLocation, yPos],
                        seriesIndex: series.seriesIndex,
                        series: series
                    });
                });

                lines.dispatch.elementClick(allData);
            });

            interactiveLayer.dispatch.on("elementMouseout",function(e) {
                lines.clearHighlights();
            });

            dispatch.on('changeState', function(e) {
                if (typeof e.disabled !== 'undefined' && data.length === e.disabled.length) {
                    data.forEach(function(series,i) {
                        series.disabled = e.disabled[i];
                    });

                    state.disabled = e.disabled;
                }
                chart.update();
            });

            //============================================================
            // Functions
            //------------------------------------------------------------

            // Taken from crossfilter (http://square.github.com/crossfilter/)
            function resizePath(d) {
                var e = +(d == 'e'),
                    x = e ? 1 : -1,
                    y = availableHeight / 3;
                return 'M' + (0.5 * x) + ',' + y
                    + 'A6,6 0 0 ' + e + ' ' + (6.5 * x) + ',' + (y + 6)
                    + 'V' + (2 * y - 6)
                    + 'A6,6 0 0 ' + e + ' ' + (0.5 * x) + ',' + (2 * y)
                    + 'Z'
                    + 'M' + (2.5 * x) + ',' + (y + 8)
                    + 'V' + (2 * y - 8)
                    + 'M' + (4.5 * x) + ',' + (y + 8)
                    + 'V' + (2 * y - 8);
            }

            function onBrush(extent) {
                // Update Main (Focus)
                var focusLinesWrap = g.select('.nv-focus .nv-linesWrap')
                    .datum(
                    data.filter(function(d) { return !d.disabled; })
                        .map(function(d,i) {
                            return {
                                key: d.key,
                                area: d.area,
                                classed: d.classed,
                                values: d.values.filter(function(d,i) {
                                    return lines.x()(d,i) >= extent[0] && lines.x()(d,i) <= extent[1];
                                }),
                                disableTooltip: d.disableTooltip
                            };
                        })
                );
                focusLinesWrap.transition().duration(duration).call(lines);

                // Update Main (Focus) Axes
                updateXAxis();
                updateYAxis();
            }
        });

        renderWatch.renderEnd('lineChart immediate');
        return chart;
    }


    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    lines.dispatch.on('elementMouseover.tooltip', function(evt) {
        if(!evt.series.disableTooltip){
            tooltip.data(evt).hidden(false);
        }
    });

    lines.dispatch.on('elementMouseout.tooltip', function(evt) {
        tooltip.hidden(true);
    });

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.lines = lines;
    chart.legend = legend;
    chart.focus = focus;
    chart.xAxis = xAxis;
    chart.x2Axis = focus.xAxis
    chart.yAxis = yAxis;
    chart.y2Axis = focus.yAxis
    chart.interactiveLayer = interactiveLayer;
    chart.tooltip = tooltip;
    chart.state = state;
    chart.dispatch = dispatch;
    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        showLegend: {get: function(){return showLegend;}, set: function(_){showLegend=_;}},
        legendPosition: {get: function(){return legendPosition;}, set: function(_){legendPosition=_;}},
        showXAxis:      {get: function(){return showXAxis;}, set: function(_){showXAxis=_;}},
        showYAxis:    {get: function(){return showYAxis;}, set: function(_){showYAxis=_;}},
        defaultState:    {get: function(){return defaultState;}, set: function(_){defaultState=_;}},
        noData:    {get: function(){return noData;}, set: function(_){noData=_;}},
        // Focus options, mostly passed onto focus model.
        focusEnable:    {get: function(){return focusEnable;}, set: function(_){focusEnable=_;}},
        focusHeight:     {get: function(){return focus.height();}, set: function(_){focus.height(_);}},
        focusShowAxisX:    {get: function(){return focus.showXAxis();}, set: function(_){focus.showXAxis(_);}},
        focusShowAxisY:    {get: function(){return focus.showYAxis();}, set: function(_){focus.showYAxis(_);}},
        brushExtent: {get: function(){return focus.brushExtent();}, set: function(_){focus.brushExtent(_);}},

        // options that require extra logic in the setter
        focusMargin: {get: function(){return focus.margin}, set: function(_){
            if (_.top !== undefined) {
                margin.top = _.top;
                marginTop = _.top;
            }
            focus.margin.right  = _.right  !== undefined ? _.right  : focus.margin.right;
            focus.margin.bottom = _.bottom !== undefined ? _.bottom : focus.margin.bottom;
            focus.margin.left   = _.left   !== undefined ? _.left   : focus.margin.left;
        }},
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
            lines.duration(duration);
            focus.duration(duration);
            xAxis.duration(duration);
            yAxis.duration(duration);
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
            legend.color(color);
            lines.color(color);
            focus.color(color);
        }},
        interpolate: {get: function(){return lines.interpolate();}, set: function(_){
            lines.interpolate(_);
            focus.interpolate(_);
        }},
        xTickFormat: {get: function(){return xAxis.tickFormat();}, set: function(_){
            xAxis.tickFormat(_);
            focus.xTickFormat(_);
        }},
        yTickFormat: {get: function(){return yAxis.tickFormat();}, set: function(_){
            yAxis.tickFormat(_);
            focus.yTickFormat(_);
        }},
        x: {get: function(){return lines.x();}, set: function(_){
            lines.x(_);
            focus.x(_);
        }},
        y: {get: function(){return lines.y();}, set: function(_){
            lines.y(_);
            focus.y(_);
        }},
        rightAlignYAxis: {get: function(){return rightAlignYAxis;}, set: function(_){
            rightAlignYAxis = _;
            yAxis.orient( rightAlignYAxis ? 'right' : 'left');
        }},
        useInteractiveGuideline: {get: function(){return useInteractiveGuideline;}, set: function(_){
            useInteractiveGuideline = _;
            if (useInteractiveGuideline) {
                lines.interactive(false);
                lines.useVoronoi(false);
            }
        }}
    });

    nv.utils.inheritOptions(chart, lines);
    nv.utils.initOptions(chart);

    return chart;
};

nv.models.lineWithFocusChart = function() {
  return nv.models.lineChart()
    .margin({ bottom: 30 })
    .focusEnable( true );
};

nv.models.discreteBarChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var discretebar = nv.models.discreteBar()
        , xAxis = nv.models.axis()
        , yAxis = nv.models.axis()
	, legend = nv.models.legend()
        , tooltip = nv.models.tooltip()
        ;

    var margin = {top: 15, right: 10, bottom: 50, left: 60}
        , marginTop = null
        , width = null
        , height = null
        , color = nv.utils.getColor()
	, showLegend = false
        , showXAxis = true
        , showYAxis = true
        , rightAlignYAxis = false
        , staggerLabels = false
        , wrapLabels = false
        , rotateLabels = 0
        , x
        , y
        , noData = null
        , dispatch = d3.dispatch('beforeUpdate','renderEnd')
        , duration = 250
        ;

    xAxis
        .orient('bottom')
        .showMaxMin(false)
        .tickFormat(function(d) { return d })
    ;
    yAxis
        .orient((rightAlignYAxis) ? 'right' : 'left')
        .tickFormat(d3.format(',.1f'))
    ;

    tooltip
        .duration(0)
        .headerEnabled(false)
        .valueFormatter(function(d, i) {
            return yAxis.tickFormat()(d, i);
        })
        .keyFormatter(function(d, i) {
            return xAxis.tickFormat()(d, i);
        });

    //============================================================
    // Private Variables
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch, duration);

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(discretebar);
        if (showXAxis) renderWatch.models(xAxis);
        if (showYAxis) renderWatch.models(yAxis);

        selection.each(function(data) {
            var container = d3.select(this),
                that = this;
            nv.utils.initSVG(container);
            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function() {
                dispatch.beforeUpdate();
                container.transition().duration(duration).call(chart);
            };
            chart.container = this;

            // Display No Data message if there's nothing to show.
            if (!data || !data.length || !data.filter(function(d) { return d.values.length }).length) {
                nv.utils.noData(chart, container);
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup Scales
            x = discretebar.xScale();
            y = discretebar.yScale().clamp(true);

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-discreteBarWithAxes').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-discreteBarWithAxes').append('g');
            var defsEnter = gEnter.append('defs');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-x nv-axis');
            gEnter.append('g').attr('class', 'nv-y nv-axis')
                .append('g').attr('class', 'nv-zeroLine')
                .append('line');

            gEnter.append('g').attr('class', 'nv-barsWrap');
	    gEnter.append('g').attr('class', 'nv-legendWrap');

            g.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            // Legend
            if (!showLegend) {
                g.select('.nv-legendWrap').selectAll('*').remove();
            } else {
                legend.width(availableWidth);

                g.select('.nv-legendWrap')
                    .datum(data)
                    .call(legend);

                if (!marginTop && legend.height() !== margin.top) {
                    margin.top = legend.height();
                    availableHeight = nv.utils.availableHeight(height, container, margin);
                }

                wrap.select('.nv-legendWrap')
                    .attr('transform', 'translate(0,' + (-margin.top) +')')
            }

            if (rightAlignYAxis) {
                g.select(".nv-y.nv-axis")
                    .attr("transform", "translate(" + availableWidth + ",0)");
            }

            // Main Chart Component(s)
            discretebar
                .width(availableWidth)
                .height(availableHeight);

            var barsWrap = g.select('.nv-barsWrap')
                .datum(data.filter(function(d) { return !d.disabled }));

            barsWrap.transition().call(discretebar);


            defsEnter.append('clipPath')
                .attr('id', 'nv-x-label-clip-' + discretebar.id())
                .append('rect');

            g.select('#nv-x-label-clip-' + discretebar.id() + ' rect')
                .attr('width', x.rangeBand() * (staggerLabels ? 2 : 1))
                .attr('height', 16)
                .attr('x', -x.rangeBand() / (staggerLabels ? 1 : 2 ));

            // Setup Axes
            if (showXAxis) {
                xAxis
                    .scale(x)
                    ._ticks( nv.utils.calcTicksX(availableWidth/100, data) )
                    .tickSize(-availableHeight, 0);

                g.select('.nv-x.nv-axis')
                    .attr('transform', 'translate(0,' + (y.range()[0] + ((discretebar.showValues() && y.domain()[0] < 0) ? 16 : 0)) + ')');
                g.select('.nv-x.nv-axis').call(xAxis);

                var xTicks = g.select('.nv-x.nv-axis').selectAll('g');
                if (staggerLabels) {
                    xTicks
                        .selectAll('text')
                        .attr('transform', function(d,i,j) { return 'translate(0,' + (j % 2 == 0 ? '5' : '17') + ')' })
                }

                if (rotateLabels) {
                    xTicks
                        .selectAll('.tick text')
                        .attr('transform', 'rotate(' + rotateLabels + ' 0,0)')
                        .style('text-anchor', rotateLabels > 0 ? 'start' : 'end');
                }

                if (wrapLabels) {
                    g.selectAll('.tick text')
                        .call(nv.utils.wrapTicks, chart.xAxis.rangeBand())
                }
            }

            if (showYAxis) {
                yAxis
                    .scale(y)
                    ._ticks( nv.utils.calcTicksY(availableHeight/36, data) )
                    .tickSize( -availableWidth, 0);

                g.select('.nv-y.nv-axis').call(yAxis);
            }

            // Zero line
            g.select(".nv-zeroLine line")
                .attr("x1",0)
                .attr("x2",(rightAlignYAxis) ? -availableWidth : availableWidth)
                .attr("y1", y(0))
                .attr("y2", y(0))
            ;
        });

        renderWatch.renderEnd('discreteBar chart immediate');
        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------

    discretebar.dispatch.on('elementMouseover.tooltip', function(evt) {
        evt['series'] = {
            key: chart.x()(evt.data),
            value: chart.y()(evt.data),
            color: evt.color
        };
        tooltip.data(evt).hidden(false);
    });

    discretebar.dispatch.on('elementMouseout.tooltip', function(evt) {
        tooltip.hidden(true);
    });

    discretebar.dispatch.on('elementMousemove.tooltip', function(evt) {
        tooltip();
    });

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    chart.dispatch = dispatch;
    chart.discretebar = discretebar;
    chart.legend = legend;
    chart.xAxis = xAxis;
    chart.yAxis = yAxis;
    chart.tooltip = tooltip;

    chart.options = nv.utils.optionsFunc.bind(chart);

    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
	showLegend: {get: function(){return showLegend;}, set: function(_){showLegend=_;}},
        staggerLabels: {get: function(){return staggerLabels;}, set: function(_){staggerLabels=_;}},
        rotateLabels:  {get: function(){return rotateLabels;}, set: function(_){rotateLabels=_;}},
        wrapLabels:  {get: function(){return wrapLabels;}, set: function(_){wrapLabels=!!_;}},
        showXAxis: {get: function(){return showXAxis;}, set: function(_){showXAxis=_;}},
        showYAxis: {get: function(){return showYAxis;}, set: function(_){showYAxis=_;}},
        noData:    {get: function(){return noData;}, set: function(_){noData=_;}},

        // options that require extra logic in the setter
        margin: {get: function(){return margin;}, set: function(_){
            if (_.top !== undefined) {
                margin.top = _.top;
                marginTop = _.top;
            }
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }},
        duration: {get: function(){return duration;}, set: function(_){
            duration = _;
            renderWatch.reset(duration);
            discretebar.duration(duration);
            xAxis.duration(duration);
            yAxis.duration(duration);
        }},
        color:  {get: function(){return color;}, set: function(_){
            color = nv.utils.getColor(_);
            discretebar.color(color);
	    legend.color(color);
        }},
        rightAlignYAxis: {get: function(){return rightAlignYAxis;}, set: function(_){
            rightAlignYAxis = _;
            yAxis.orient( (_) ? 'right' : 'left');
        }}
    });

    nv.utils.inheritOptions(chart, discretebar);
    nv.utils.initOptions(chart);

    return chart;
}
nv.models.packedBubbleChart = function() {
    "use strict";

    //============================================================
    // Public Variables with Default Settings
    //------------------------------------------------------------

    var packedBubble = nv.models.packedBubble()
        , tooltip = nv.models.tooltip()
        ;

    var margin = {top: 0, right: 0, bottom: 0, left: 0}
        , width = null
        , height = null
        , color = nv.utils.defaultColor()
        , noData = null
        , dispatch = d3.dispatch('renderEnd')
        ;

    tooltip
        .headerEnabled(false)
        .duration(0)
        .valueFormatter(function(d, i) {
            return packedBubble.valueFormat()(d, i);
        });

    //============================================================
    // Chart function
    //------------------------------------------------------------

    var renderWatch = nv.utils.renderWatch(dispatch);

    function chart(selection) {
        renderWatch.reset();
        renderWatch.models(packedBubble);

        selection.each(function(data) {
            var container = d3.select(this);
            nv.utils.initSVG(container);

            var availableWidth = nv.utils.availableWidth(width, container, margin),
                availableHeight = nv.utils.availableHeight(height, container, margin);

            chart.update = function() { container.transition().call(chart); };
            chart.container = this;

            // Display No Data message if there's nothing to show.
            if (!data) {
                nv.utils.noData(chart, container);
                return chart;
            } else {
                container.selectAll('.nv-noData').remove();
            }

            // Setup containers and skeleton of chart
            var wrap = container.selectAll('g.nv-wrap.nv-packedBubbleChart').data([data]);
            var gEnter = wrap.enter().append('g').attr('class', 'nvd3 nv-wrap nv-packedBubbleChart').append('g');
            var g = wrap.select('g');

            gEnter.append('g').attr('class', 'nv-packedBubbleWrap');

            wrap.attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            // Main Chart Component(s)
            packedBubble.width(availableWidth).height(availableHeight);
            var packedBubbleWrap = g.select('.nv-packedBubbleWrap').datum(data);
            d3.transition(packedBubbleWrap).call(packedBubble);
        });

        renderWatch.renderEnd('packedBubble chart immediate');
        return chart;
    }

    //============================================================
    // Event Handling/Dispatching (out of chart's scope)
    //------------------------------------------------------------
    packedBubble.dispatch.on('elementMouseover.tooltip', function(evt) {
        evt['series'] = {
            key: evt.data.name,
            value: evt.data,
            color: evt.color
        };

        tooltip.data(evt).hidden(false);
    });

    packedBubble.dispatch.on('elementMouseout.tooltip', function(evt) {
        tooltip.hidden(true);
    });

    packedBubble.dispatch.on('elementMousemove.tooltip', function(evt) {
        tooltip.position();
    });

    //============================================================
    // Expose Public Variables
    //------------------------------------------------------------

    // expose chart's sub-components
    chart.dispatch = dispatch;
    chart.packedBubble = packedBubble;
    chart.options = nv.utils.optionsFunc.bind(chart);
    chart.tooltip = tooltip;

    // use Object get/set functionality to map between vars and chart functions
    chart._options = Object.create({}, {
        // simple options, just get/set the necessary values
        width:      {get: function(){return width;}, set: function(_){width=_;}},
        height:     {get: function(){return height;}, set: function(_){height=_;}},
        noData:         {get: function(){return noData;}, set: function(_){noData=_;}},

        // options that require extra logic in the setter
        color: {get: function(){return color;}, set: function(_){
            color = _;
            packedBubble.color(color);
        }},
        margin: {get: function(){return margin;}, set: function(_){
            margin.top    = _.top    !== undefined ? _.top    : margin.top;
            margin.right  = _.right  !== undefined ? _.right  : margin.right;
            margin.bottom = _.bottom !== undefined ? _.bottom : margin.bottom;
            margin.left   = _.left   !== undefined ? _.left   : margin.left;
        }}
    });

    nv.utils.inheritOptions(chart, packedBubble);
    nv.utils.initOptions(chart);

    return chart;
};

nv.version = "1.8.4-dev";
})();
//# sourceMappingURL=nv.d3.js.map