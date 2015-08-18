/*
Copyright 2015 OpenMarket Ltd

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

'use strict';

var React = require('react');

var MatrixClientPeg = require("../../../../src/MatrixClientPeg");
var HealthDemoTileController = require("../../../../src/controllers/molecules/HealthDemoTile");
var ComponentBroker = require('../../../../src/ComponentBroker');
var MessageTimestamp = ComponentBroker.get('atoms/MessageTimestamp');
var MemberAvatar = ComponentBroker.get('atoms/MemberAvatar');
var TextForEvent = require("../../../../src/TextForEvent");

module.exports = React.createClass({
    displayName: 'HealthDemoTile',
    mixins: [HealthDemoTileController],

    render: function() {
        var ts = this.props.mxEvent.getContent().ts;
        var date = new Date(ts*1000);
        var timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        //var timestamp = <MessageTimestamp ts={this.props.mxEvent.getContent().ts} />;

        var imgStyle = { float: 'left' };

        return (
            <div className="mx_HealthDemoTile">
                <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH3wgSDys3IE3P1AAAA2lJREFUWMPNmMuLFUcUxn+n03ONzkRNxOhERQQfgxhXBhNiFB+ICxdZCSJkJbVS0LUIbgyBgLMQRAr8N1xIRCVmsogSETQZBYOPGZPAEIcRR8c7HjenoWyqr/dO9SX3QN/ue+r19VffOVXVkGBepC1fikkNAAX4BpgPXHOqL+sEmKU0dqoAB4BLwEXgZN0sZjX0cRCYZ30doWbLatDf2sC90IssNWb/X4ABiHWloq97RoNe5EOgUXJv6xmApekt7Ks6AyUV4PqIb0NJAj3HYJ8X2VhX4k4FuC7iawCbCnAFkwXQTgFniSkmBrAP2BzUHfAiV4EXXuSYU+0IZJaYYtZEij8otBmsNDtsKRz2Iis7AZmSqHNgoKL4My/ysT3vKpWd7SSIUjS4ytiK2TJgeQXAvV7ky3b1mAJwZQngX0DTnpcDS71IPzBYarcAONoui6kAc3ueBa4DM/Z/APg0wl5hO73IF+0EY5YQwSsCBqcM4OtSjtxT0c2gBc97gzH3ImJpYSfwpsUmVoCfnerNCINTwAjwElhkviFga9D+jrUpyg97kbWBLEJrWjCN5Bb+PwD7SgxUMbjFqd42FiQA+BT40wIEYHcQKAC/AneBM/Z/MfBti6EmgBuZ6fCTIMm+7/ouGKCwSeCFTXNMowCjTnUYGGtTTXnx0zT6hyIMFi/QHwy2y4s0gIUhQKc67UV+aTHgqN0PAT/aLrxVGF8Fmrnp5gRwIdIgs7X1OLDffKuBjcBHQb3/7D5SMdi4XTjVa15kr2mxCuAM8I9T1dxy0VO7qnT3eQCwYfoqACrwtw0+6UUmgCWlLt7p36k+A57VmWZGg2hrWH7rDyLucVA3Ns1jTnV8Lmt+uwDHA3H32bljIEjSofDL0/ym0N9c9obtAhwLQIjpZ17A4JOg7vWInm51dcPqVCeARxXFsyWA9yIAf5/rMSBrR6hmt1pk/XCKXwUpBWDaqf7RNQaDt75pg5dtyqnOlgCG03wp5WySd1D3twoGH4TnD6f6yot8b6lnBjifcsrLOgj5SeBhpOheGYBTfQCcAk471X9TTnZ5h/WvhAcis/sVL9SMyKTrx86fIr77dNE6BXi5pwE61ekIoJ5isDzNz53qbN3fpVOCBOAcsN3W4uE6PxQlW/B9ZdCLDNX5ma3roLtlbwGzvhTlwr9lXgAAAABJRU5ErkJggg==" style={imgStyle} />
                <div>
                    <span className="mx_HealthDemoTile_ts">{timeStr}</span>
                    <span className="mx_HealthDemoTile_content">
                        {this.props.mxEvent.getContent().bpm} bpm
                    </span>
                </div>
            </div>
        );
    },
});

