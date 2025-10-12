import { Object } from '../base/Object.js';
import { Window } from '../base/Window.js';
export class World {
    constructor(objects = [], windows = []) {
        this.objects = objects;
        this.windows = windows;
    }
}