'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model');
const {getProfile} = require('./middleware/getProfile');
const app = express();
const { Op } = require('sequelize');

app.use(bodyParser.json());
app.set('sequelize', sequelize);
app.set('models', sequelize.models);

/*
Below is a list of the required API's for the application.
GET /contracts/:id - This API is broken 😵! it should return the contract only if it belongs to the profile calling. better fix that!
GET /contracts - Returns a list of contracts belonging to a user (client or contractor), the list should only contain non terminated contracts.
GET /jobs/unpaid - Get all unpaid jobs for a user (either a client or contractor), for active contracts only.

POST /jobs/:job_id/pay - Pay for a job, a client can only pay if his balance >= the amount to pay. The amount should be moved from the client's balance to the contractor balance.
POST /balances/deposit/:userId - Deposits money into the the the balance of a client, a client can't deposit more than 25% his total of jobs to pay. (at the deposit moment)

GET /admin/best-profession?start=<date>&end=<date> - Returns the profession that earned the most money (sum of jobs paid) for any contactor that worked in the query time range.
GET /admin/best-clients?start=<date>&end=<date>&limit=<integer> - returns the clients the paid the most for jobs in the query time period. limit query parameter should be applied, default limit is 2.
*/


/**
 * @returns a contract by id, belongs to the profile
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
    const {Contract} = req.app.get('models');
    const {id} = req.params;
    const profileId = req.get('profile_id') || 0;
    const contract = await Contract.findOne({
    where: {
        id,
        [Op.or]: [
            { ClientId: profileId },
            { ContractorId: profileId }
          ]
    }
    });
    if (!contract) {
        return res.status(404).end();
    };
    res.json(contract);
})

/**
 * @returns a list of contracts belonging to a user (client or contractor), the list should only contain non terminated contracts.
 */
 app.get('/contracts/', getProfile, async (req, res) => {
    const {Contract} = req.app.get('models');
    const profileId = req.get('profile_id') || 0;
    const contracts = await Contract.findAll({
        where: {
            [Op.or]: [
                { ClientId: profileId },
                { ContractorId: profileId }
              ]
        }
    });
    res.json(contracts);
})


/**
 * @returns all unpaid jobs for a user, for active contracts only.
 */
 app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const {Job, Contract} = req.app.get('models');
    const profileId = req.get('profile_id') || 0;
    const jobs = await Job.findAll({
        where: {
            paid : {[Op.not]: true}
        },
        include: [{ 
            model: Contract, 
            where: {
                status : {[Op.ne]: 'terminated' },
                [Op.or]: [{ ClientId: profileId }, { ContractorId: profileId }]
            }, 
            attributes:[]
        }],
    });
    res.json(jobs);
})


/**
 * @returns job after payment, a client can only pay if his balance >= the amount to pay. The amount should be moved from the client's balance to the contractor balance.
 */

app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {

    try {
        const result = await sequelize.transaction(async (t) => {

            const {Job, Contract, Profile} = req.app.get('models');
            const profileId = req.get('profile_id') || 0;
            const {job_id} = req.params;



            const client = await Profile.findOne({
                where: {
                    id : profileId,
                    type : {[Op.eq]: 'client' },
                },
            }, { transaction: t });
            if (!client) {
                return res.status(403).send({ message: 'Only for clients' });
            };



            const job = await Job.findOne({
                where: {
                    id : job_id,
                    paid : {[Op.not]: true}
                },
                include: [{ 
                    model: Contract, 
                    where: {
                        status : {[Op.ne]: 'terminated' }
                    }, 
                    attributes:['ContractorId']
                }],
            }, { transaction: t });
            if (!job) {
                return res.status(404).send({ message: 'No matching jobs'});
            };



            if (client.balance <= job.price) {
                return res.status(403).send({ message: 'Not enough money on balance'});
            }



            const contractorId = job.Contract.ContractorId;
            const contractor = await Profile.findOne({
                where: { id : contractorId }
            });

            const newClientBalance = client.balance - job.price;
            await client.update({ balance: newClientBalance }, { transaction: t });

            const newContractorBalance = contractor.balance + job.price;
            await contractor.update({ balance: newContractorBalance }, { transaction: t });

            await job.update({ paid: true }, { transaction: t });
            return job;

        });

        res.json(result);


    } catch (error) {
        console.error('transaction erroe', error);
        return res.status(500).send({ message: '500 Internal Server Error '});
    }
})



module.exports = app;
