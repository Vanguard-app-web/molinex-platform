import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {ApiError} from '../shared/api-error.js';
import {FieldProblems, normalizeEmail} from '../shared/validation.js';

/** Adds the `commercial` section (inquiries) to a private data document. Returns true when it changed. */
export function ensureCommercialData(data) {
    if (Array.isArray(data.commercial?.inquiries)) return false;
    data.commercial = {inquiries: []};
    return true;
}

const isTextList = value => Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim() !== '');

/**
 * Reads and validates the public commercial content: the plan catalog and the value proposition.
 * The content is read-only through the API; it is edited in the JSON file.
 * @param {string} contentPath
 * @returns {{plans: {id: string, name: string, priceLabel: string, features: string[]}[],
 *            valueProposition: {headline: string, benefits: string[]}}}
 */
export function loadCommercialContent(contentPath) {
    let content;
    try {
        // A byte order mark, which some Windows editors add, is not part of the JSON text.
        content = JSON.parse(fs.readFileSync(contentPath, 'utf8').replace(/^﻿/, ''));
    } catch (error) {
        throw new Error(`The commercial content file ${contentPath} could not be read: ${error.message}`);
    }

    const {plans, valueProposition} = content;
    const validPlans = Array.isArray(plans) && plans.every(plan =>
        typeof plan?.id === 'string' && plan.id.trim() !== ''
        && typeof plan.name === 'string' && plan.name.trim() !== ''
        && typeof plan.priceLabel === 'string' && plan.priceLabel.trim() !== ''
        && isTextList(plan.features));
    const validProposition = typeof valueProposition?.headline === 'string' && valueProposition.headline.trim() !== ''
        && isTextList(valueProposition.benefits);
    if (!validPlans || !validProposition) {
        throw new Error(`The commercial content file ${contentPath} does not follow the PlanResource and ValuePropositionResource formats.`);
    }
    return {plans, valueProposition};
}

/**
 * Application service of Commercial Engagement in the mock API: serves the public offer and stores
 * commercial inquiries in the private data file (never in a public JSON Server collection).
 */
export class CommercialService {
    #store;
    #content;

    /**
     * @param {import('../shared/private-data-store.js').PrivateDataStore} store
     * @param {ReturnType<typeof loadCommercialContent>} content
     */
    constructor(store, content) {
        this.#store = store;
        this.#content = content;
    }

    getPlans() {
        return this.#content.plans.map(plan => ({...plan, features: [...plan.features]}));
    }

    getValueProposition() {
        const {headline, benefits} = this.#content.valueProposition;
        return {headline, benefits: [...benefits]};
    }

    /**
     * Stores an inquiry. The identifier and the submission time are always assigned here; any `id`
     * or `submittedAt` sent by the client is ignored.
     */
    createInquiry(body) {
        const problems = new FieldProblems()
            .requireText(body.fullName, 'fullName')
            .requireEmail(body.email)
            .optionalPhone(body.phone, 'phone')
            .requireText(body.companyName, 'companyName')
            .requireText(body.message, 'message');
        if (problems.hasProblems) throw ApiError.validation(problems.list);

        const inquiry = {
            id: `inq-${randomUUID()}`,
            fullName: body.fullName.trim(),
            email: normalizeEmail(body.email),
            ...(typeof body.phone === 'string' && body.phone.trim() !== '' ? {phone: body.phone.trim()} : {}),
            companyName: body.companyName.trim(),
            message: body.message.trim(),
            submittedAt: new Date().toISOString()
        };
        this.#store.data.commercial.inquiries.push(inquiry);
        this.#store.commit();
        return {...inquiry};
    }
}
