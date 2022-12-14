'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model');
const {getProfile} = require('./middleware/getProfile');
const app = express();
const { Op } = require('sequelize');
const e = require('express');

app.use(bodyParser.json());
app.set('sequelize', sequelize);
app.set('models', sequelize.models);


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
    if (!contracts.length) {
        return res.status(404).end();
    };
    res.json(contracts);
})


/**
 * @returns all unpaid jobs for a user, for active contracts only.
 */
 app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const {Job, Contract} = req.app.get('models');
    const profileId = req.get('profile_id') || 0;
    const unpaidJobs = await Job.findAll({
        where: {
            paid : {[Op.not]: true}
        },
        include: [{ 
            model: Contract, 
            where: {
                status : {[Op.ne]: 'terminated' },
                [Op.or]: [
                    { ClientId: profileId }, 
                    { ContractorId: profileId }
                ]
            }, 
            attributes:[]
        }],
    });
    if (!unpaidJobs.length) {
        return res.status(404).end();
    };
    res.json(unpaidJobs);
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

            // Get and check client, start
            const client = await Profile.findOne({
                where: {
                    id : profileId,
                    type : {[Op.eq]: 'client' },
                },
            }, { transaction: t });

            if (!client) {
                return res.status(403).send({ message: 'Only for clients' });
            };
            //Get and check client, end

            // Get and check job, start
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
            // Get and check job, end

            // Check client balance
            if (client.balance <= job.price) {
                return res.status(403).send({ message: 'Not enough money on balance'});
            }

            // Get contractor, start
            const contractorId = job.Contract.ContractorId;
            const contractor = await Profile.findOne({
                where: { id : contractorId }
            });
            // Get contractor, end

            // Update data, start
            const newClientBalance = client.balance - job.price;
            await client.update({ balance: newClientBalance }, { transaction: t });

            const newContractorBalance = contractor.balance + job.price;
            await contractor.update({ balance: newContractorBalance }, { transaction: t });

            await job.update({ paid: true }, { transaction: t });
            // Update data, end

            return job;

        });

        res.json(result);

    } catch (error) {
        console.error('transaction error', error);
        return res.status(500).send({ message: '500 Internal Server Error '});
    }
})


/**
 * @returns transaction status after deposits money into the the the balance of a client, a client can't deposit more than 25% his total of jobs to pay. (at the deposit moment)
 */

// TODO: Sorry, but I didn't understand the endpoint logic. Need clarification from the business.
app.post('/balances/deposit/:userId', getProfile, async (req, res) => {
    res.json('TBD');
})



/**
 * @returns Returns the profession that earned the most money (sum of jobs paid) for any contactor that worked in the query time range. Params: start=<date>&end=<date>
 */

app.get('/admin/best-profession', getProfile, async (req, res) => {
    // TODO: Need some check for admin status!
    const { start, end } = req.query;

    // Get time range, start
    let startDay, endDay;
    try {
        startDay = start ? new Date(start) : new Date(0);
        endDay = end ? new Date(end) : new Date();

        if(!(startDay instanceof Date && !isNaN(startDay)) || !(endDay instanceof Date && !isNaN(endDay))) {
            throw Error('Wrong date format');
        }
    } catch(e) {
        return res.status(400).send({ message: 'Wrong date format'});
    }
    // Get time range, end

    // TODO: it is not entirely clear, should we take data regarding what job or something else? need to clarify

    // Get all paid job, with contractor profession, start
    const {Job, Contract} = req.app.get('models');
    const jobs = await Job.findAll({
        where: {
            paid : {[Op.eq]: true},
            createdAt: {[Op.between]: [startDay, endDay]}
        },
        attributes:['price'],
        include: [{ 
            model: Contract,
            attributes:['id'],
            include: [
                {
                    association: 'Contractor', 
                    attributes:['profession']
                }
            ],
        }],
    });
    // Get all paid job, with contractor profession, end

    // Calculate the richest proffesions, start
    const professionPayments = jobs.reduce((accum, current) => {
        const key = current.Contract.Contractor.profession;
        const prevValue = accum[key] || 0;
        accum[key] = prevValue + current.price;
        return accum;
    }, {});

    const biggestPayments = Math.max(...Object.values(professionPayments));
    const richestProfessions = Object.keys(professionPayments).filter(key => professionPayments[key] === biggestPayments);
    // Calculate the richest proffesions, end

    //Prepare message, start
    let message;
    if (richestProfessions.length > 1) {
        message = 'The richest professions are: ' + richestProfessions.join() + '!';
    } else {
        message = 'The richest profession is: ' + richestProfessions[0] + '!';
    }
    //Prepare message, end

    res.json(message);
})

/**
 * @returns the clients the paid the most for jobs in the query time period. limit query parameter should be applied, default limit is 2.
 * 
 */

// TODO: Sorry, did not have time for last end point.
app.get('/admin/best-clients', getProfile, async (req, res) => {
    res.json('TBD');
})

module.exports = app;
