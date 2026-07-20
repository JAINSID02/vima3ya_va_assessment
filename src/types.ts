export type Availability = "available" | "out-of-stock" | "limited" ;

export interface MenuItem {

    id:string;
    name : string;
    category: "starters" | "mains" | "drinks" | "desserts";
    price:number;
    description:string;
    tags : string[];
    availability : Availability;
}

export interface OrderLine{
    itemId : string;
    name:string;
    quantity:number;
    unitPrice : number;
}

export interface OrderSummary{
    lines : OrderLine[];
    total : number;
}

// ----------------------------- Intents --------------------------------
// The NLU layer's job is to turn a raw utterance + context into one of
// these typed intents. The orchestrator only ever acts on typed intents,
// never on raw strings — this is the seam that keeps reasoning decoupled
// from tool-calling.

export type Intent = 
| {type : "GREETING"}
| {type : "LIST_MENU" ; category? : MenuItem["category"]}
| { type: "RECOMMEND"; constraint?: string }
| {type : "ADD_ITEM";
    itemRef : string;
    quantity? : number;
}
| {
    type : "MODIFY_ITEM";
    itemRef : string;
    change: "remove" | "set_quantity" | "increment" | "decrement";
    quantity? : number;
}

| { type: "MENU_QUESTION"; itemRef?: string; question: string }
| { type: "ORDER_SUMMARY" }
| { type: "CONFIRM_ORDER" }
| { type: "UNKNOWN"; raw: string };

// ----------------------------- Conversation ------------------------------

export interface Turn {
    speaker : "user" | "agent" ;
    text : string;
}

export interface ConversationContext {
    lastMentionedItemId : string | null ;
    turns : Turn[];
}