import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,it,expect} from "vitest";
import {CapacityGuidance} from "./CapacityGuidance.js";
describe("capacity guidance",()=>{
 it("explains the unchanged caps, admission constraint and actual initial charge",()=>{const h=renderToStaticMarkup(React.createElement(CapacityGuidance));for(const t of ['role="note"','1 USDC','10 USDC','2A + R ≤ 1 USDC','0.333333 USDC','Initial funding is only A + R','not an additional token charge','not yet deployed'])expect(h).toContain(t);expect(h).not.toContain('<button');});
 it("explains claim then confirmed fresh review without automatic payment",()=>{const h=renderToStaticMarkup(React.createElement(CapacityGuidance,{renewal:true}));for(const t of ['claiming accrued provider earnings first','pays the agreed provider','Wait for confirmation','refresh the review','early prepayments'])expect(h).toContain(t);expect(h).not.toContain('<button');});
});
