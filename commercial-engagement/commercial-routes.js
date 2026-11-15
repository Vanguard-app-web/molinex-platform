import {createRouteTable} from '../shared/route-table.js';
import {bodyOf} from '../shared/validation.js';

/**
 * Commercial Engagement endpoints, mounted at `/api/v1/commercial`. All of them are public.
 *
 * | Method | Path | Result |
 * | --- | --- | --- |
 * | GET | /plans | 200, PlanResource[] (possibly empty) |
 * | GET | /value-proposition | 200, ValuePropositionResource |
 * | POST | /inquiries | 201, CommercialInquiryResource, with Location |
 *
 * Inquiries are write-only: there is no endpoint that lists or reads them.
 *
 * @param {import('./commercial-service.js').CommercialService} commercial
 * @returns {import('express').RequestHandler}
 */
export function createCommercialRoutes(commercial) {
    return createRouteTable([
        {
            method: 'GET', path: '/plans',
            handler: async (_request, response) => {
                response.status(200).json(commercial.getPlans());
            }
        },
        {
            method: 'GET', path: '/value-proposition',
            handler: async (_request, response) => {
                response.status(200).json(commercial.getValueProposition());
            }
        },
        {
            method: 'POST', path: '/inquiries',
            handler: async (request, response) => {
                const inquiry = commercial.createInquiry(bodyOf(request));
                response.setHeader('Location', `/api/v1/commercial/inquiries/${inquiry.id}`);
                response.setHeader('Access-Control-Expose-Headers', 'Location');
                response.status(201).json(inquiry);
            }
        }
    ]);
}
